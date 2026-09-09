import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  isObjectType,
  parse,
  print,
  validate,
  type GraphQLSchema,
  type IntrospectionQuery,
} from 'graphql'
import { schema } from '../server/wandb/schema.ts'
import * as queries from '../../typescript/packages/core/src/core/wandb/queries.ts'

interface Field {
  type: string
  args: Record<string, { type: string; default: unknown }>
}
interface Capture {
  source: string
  captured_at: string
  fields: Record<string, Record<string, Field>>
}
const capture = JSON.parse(
  readFileSync(new URL('./schema.json', import.meta.url), 'utf8'),
) as Capture

function surface(live: GraphQLSchema): Capture['fields'] {
  return Object.fromEntries(
    Object.entries(capture.fields).map(([name, fields]) => {
      const type = live.getType(name)
      assert(isObjectType(type), name)
      return [
        name,
        Object.fromEntries(
          Object.entries(fields).map(([fieldName, field]) => {
            const definition = type.getFields()[fieldName]
            assert(definition, `${name}.${fieldName}`)
            return [
              fieldName,
              {
                type: String(definition.type),
                args: Object.fromEntries(
                  Object.keys(field.args).map((argName) => {
                    const arg = definition.args.find((a) => a.name === argName)
                    assert(arg, `${name}.${fieldName}.${argName}`)
                    return [argName, { type: String(arg.type), default: arg.defaultValue ?? null }]
                  }),
                ),
              },
            ]
          }),
        ),
      ]
    }),
  )
}

export function checkSchema(): void {
  const declared = Object.fromEntries(
    Object.entries(schema.getTypeMap())
      .filter(([name, type]) => !name.startsWith('__') && isObjectType(type))
      .map(([name, type]) => {
        assert(isObjectType(type))
        return [name, Object.keys(type.getFields()).sort()]
      }),
  )
  assert.deepEqual(
    declared,
    Object.fromEntries(
      Object.entries(capture.fields).map(([name, fields]) => [name, Object.keys(fields).sort()]),
    ),
    'Every mock field needs upstream evidence',
  )
  assert.deepEqual(surface(schema), capture.fields, 'Mock differs from the captured live schema')
  for (const [typeName, fields] of Object.entries(capture.fields)) {
    const type = schema.getType(typeName)
    assert(isObjectType(type))
    for (const [fieldName, field] of Object.entries(fields))
      assert.deepEqual(
        type
          .getFields()
          [fieldName]!.args.map((a) => a.name)
          .sort(),
        Object.keys(field.args).sort(),
      )
  }
  const declarations = Object.entries(capture.fields).map(
    ([name, fields]) =>
      `type ${name} {\n${Object.entries(fields)
        .map(([field, value]) => {
          const args = Object.entries(value.args)
            .map(([arg, def]) => `${arg}: ${def.type}`)
            .join(', ')
          return `${field}${args ? `(${args})` : ''}: ${value.type}`
        })
        .join('\n')}\n}`,
  )
  const upstream = buildSchema(
    'scalar Int64\nscalar DateTime\nscalar JSONString\nscalar JSON\n' + declarations.join('\n'),
  )
  const python = readFileSync(
    new URL('../../python/mirage/core/wandb/queries.py', import.meta.url),
    'utf8',
  )
  const pyQueries = Object.fromEntries(
    [...python.matchAll(/([A-Z_]+) = """([\s\S]*?)"""/g)].map((m) => [m[1], m[2]]),
  )
  assert.deepEqual(Object.keys(pyQueries).sort(), Object.keys(queries).sort())
  for (const [name, query] of Object.entries(queries)) {
    assert.deepEqual(
      validate(upstream, parse(query)).map((e) => e.message),
      [],
      name,
    )
    assert.equal(
      print(parse(pyQueries[name]!)),
      print(parse(query)),
      `${name}: Python/TypeScript wire parity`,
    )
  }
  console.log(
    `W&B schema: ${Object.values(capture.fields).reduce((n, fields) => n + Object.keys(fields).length, 0)} fields and ${Object.keys(queries).length} mirrored queries verified`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkSchema()
  if (process.argv.includes('--live')) {
    const response = await fetch(capture.source, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: getIntrospectionQuery({ descriptions: false }) }),
    })
    assert(response.ok, `Live introspection HTTP ${response.status}`)
    const result = (await response.json()) as { data: IntrospectionQuery; errors?: unknown[] }
    assert(!result.errors?.length, JSON.stringify(result.errors))
    assert.deepEqual(surface(buildClientSchema(result.data)), capture.fields, 'Live schema drift')
    console.log('W&B live schema matches the captured mock surface')
  }
}
