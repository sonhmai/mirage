import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execute, GraphQLError, parse, validate } from 'graphql'
import { schema } from './schema.ts'
import { rootValue } from './resolvers.ts'
import { API_KEY, fileBytes, loadFixture } from './store.ts'

export interface RequestRecord {
  query: string
  variables: Record<string, unknown>
  errors?: string[]
}
export async function startWandb(port = 0, fixtureName = 'v1', fixtureRoot?: string) {
  const fixture = loadFixture(fixtureName, fixtureRoot)
  const requests: RequestRecord[] = []
  let base = ''
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', base)
    const storage = url.pathname.startsWith('/storage/')
    if (
      storage
        ? url.searchParams.get('signature') !== 'fixture' || req.headers.authorization !== undefined
        : req.headers.authorization !== `Basic ${Buffer.from(`api:${API_KEY}`).toString('base64')}`
    ) {
      res.writeHead(401)
      res.end('unauthorized')
      return
    }
    if (req.method === 'POST' && url.pathname === '/graphql') {
      if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        res.writeHead(415, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ errors: [{ message: 'Content-Type must be application/json' }] }))
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array))
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        query: string
        variables?: Record<string, unknown>
        operationName?: string
      }
      const record: RequestRecord = { query: body.query, variables: body.variables ?? {} }
      requests.push(record)
      let document
      try {
        document = parse(body.query)
      } catch (error) {
        if (!(error instanceof GraphQLError)) throw error
        record.errors = [error.message]
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({ errors: [{ message: error.message, locations: error.locations }] }),
        )
        return
      }
      const errors = validate(schema, document)
      if (errors.length) {
        record.errors = errors.map((error) => error.message)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ errors }))
        return
      }
      const result = await execute({
        schema,
        document,
        rootValue: rootValue(fixture, base),
        variableValues: body.variables,
        operationName: body.operationName || undefined,
      })
      if (result.errors?.length) record.errors = result.errors.map((error) => error.message)
      res.writeHead(result.errors?.length ? 500 : 200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
      return
    }
    if (req.method === 'GET' && (storage || url.pathname.startsWith('/files/'))) {
      const [entity, project, id, ...path] = url.pathname
        .slice(storage ? 9 : 7)
        .split('/')
        .map(decodeURIComponent)
      const file = fixture.entities[entity!]?.[project!]?.find((r) => r.name === id)?.files[
        path.join('/')
      ]
      if (file) {
        res.writeHead(200)
        res.end(fileBytes(file))
        return
      }
    }
    res.writeHead(404)
    res.end('not found')
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      console.error('W&B mock request failed', error)
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ errors: [{ message: 'Invalid request' }] }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  base = `http://127.0.0.1:${address.port}`
  return {
    base,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}
