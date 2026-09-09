import { API_KEY } from './store.ts'
import assert from 'node:assert/strict'
import { startWandb } from './fake.ts'
export async function selftest(): Promise<void> {
  const server = await startWandb()
  const headers = {
    Authorization: `Basic ${Buffer.from(`api:${API_KEY}`).toString('base64')}`,
    'Content-Type': 'application/json',
  }
  const query = async (source: string, variables = {}) => {
    const response = await fetch(server.base + '/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: source, variables }),
    })
    assert([200, 400, 500].includes(response.status))
    return (await response.json()) as {
      data?: Record<string, unknown>
      errors?: { message: string }[]
    }
  }
  try {
    assert.equal((await fetch(server.base + '/graphql', { method: 'POST' })).status, 401)
    for (const contentType of [undefined, 'text/plain;charset=UTF-8']) {
      const response = await fetch(server.base + '/graphql', {
        method: 'POST',
        headers: {
          Authorization: headers.Authorization,
          ...(contentType ? { 'Content-Type': contentType } : {}),
        },
        body: new TextEncoder().encode(JSON.stringify({ query: '{ viewer { id } }' })),
      })
      assert.equal(response.status, 415, 'GraphQL must require a JSON media type')
      assert.deepEqual(await response.json(), {
        errors: [{ message: 'Content-Type must be application/json' }],
      })
    }
    const charset = await fetch(server.base + '/graphql', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ query: '{ viewer { entity } }' }),
    })
    assert.equal(charset.status, 200)
    assert.deepEqual(await charset.json(), { data: { viewer: { entity: 'lab' } } })
    const syntax = await query('{')
    assert.deepEqual(syntax, {
      errors: [
        {
          message: 'Syntax Error: Expected Name, found <EOF>.',
          locations: [{ line: 1, column: 2 }],
        },
      ],
    })
    const malformed = await fetch(server.base + '/graphql', {
      method: 'POST',
      headers,
      body: 'private-input-is-not-json',
    })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { errors: [{ message: 'Invalid request' }] })
    const result = await query(
      `query Alternate($owner: String!, $filter: JSONString!) {
   experiment: project(entityName: $owner, name: "experiments") {
    runCount(filters: $filter)
    matches: runs(filters: $filter, order: "+name", first: 1) { edges { node { ...R } } pageInfo { endCursor hasNextPage } }
   }
  } fragment R on Run { name displayName }`,
      { owner: 'lab', filter: JSON.stringify({ displayName: { $eq: 'duplicate' } }) },
    )
    assert.deepEqual(result, {
      data: {
        experiment: {
          runCount: 2,
          matches: {
            edges: [{ node: { name: 'run-a', displayName: 'duplicate' } }],
            pageInfo: { endCursor: 'cursor:1', hasNextPage: true },
          },
        },
      },
    })
    const next = await query(
      `{ project(entityName: "lab", name: "experiments") { runs(after: "cursor:1", first: 1) { edges { node { name } } } } }`,
    )
    assert.deepEqual(next.data, { project: { runs: { edges: [{ node: { name: 'run-b' } }] } } })
    const metricQuery =
      'query($project: String!, $filter: JSONString!) { project(entityName:"lab", name:$project) { runCount(filters:$filter) } }'
    const filtered = await query(metricQuery, {
      project: 'experiments',
      filter: JSON.stringify({ 'summary_metrics.score': { $gt: 0.3 } }),
    })
    assert.deepEqual(
      filtered.data,
      { project: { runCount: 1 } },
      'missing metrics must not fail numeric filters',
    )
    const invalid = await query(metricQuery, {
      project: 'empty',
      filter: JSON.stringify({ name: { $unsupported: true } }),
    })
    assert(invalid.errors?.some((error) => error.message.includes('unsupported filter')))
    const sampled = await query(
      `query($spec: JSONString!) { project(entityName:"lab", name:"experiments") { run(name:"run-a") { sampledHistory(specs:[$spec]) } } }`,
      { spec: JSON.stringify({ keys: ['_step', 'score'], minStep: 0, maxStep: 6, samples: 10 }) },
    )
    assert.deepEqual(sampled.data, {
      project: {
        run: {
          sampledHistory: [
            [
              { _step: 0, score: 0.1 },
              { _step: 1, score: 0.9 },
              { _step: 5, score: 0.4 },
            ],
          ],
        },
      },
    })
    const unsupported = await query(
      'query($filters: JSONString!) { project(entityName:"lab", name:"experiments") { runs(filters:$filters) { edges { node { name } } } } }',
      { filters: JSON.stringify({ bad: 1 }) },
    )
    assert(unsupported.errors?.some((error) => error.message.includes('unsupported filter')))
    for (const [filter, expected] of [
      [{ 'summary_metrics.score': null }, 2],
      [{ 'summary_metrics.score': { $ne: null } }, 1],
      [{ 'summary_metrics.score': { $in: [null, 0.4] } }, 3],
      [{ 'summary_metrics.score': { $exists: false } }, 2],
      [{ $and: [{ state: 'finished' }, { 'config.lr': { $gte: 0.01 } }] }, 1],
      [{ $or: [{ name: 'run-a' }, { name: 'run-long' }] }, 2],
    ] as const) {
      const result = await query(metricQuery, {
        project: 'experiments',
        filter: JSON.stringify(filter),
      })
      assert.deepEqual(result.data, { project: { runCount: expected } })
    }
    const sparse = await query(
      `query($spec: JSONString!) { project(entityName:"lab", name:"experiments") { run(name:"run-a") { sampledHistory(specs:[$spec]) } } }`,
      { spec: JSON.stringify({ keys: ['_step', 'score'], minStep: 0, maxStep: 6, samples: 3 }) },
    )
    assert.deepEqual(sparse, sampled, 'Select matching rows before applying the sample budget')
    const boundaries = await query(
      `query($spec:JSONString!) {
      project(entityName:"lab",name:"experiments") { run(name:"run-a") {
        history(minStep:0,maxStep:1,samples:2) sampledHistory(specs:[$spec])
        parquetHistory(liveKeys:["_step"]) { parquetUrls liveData }
      } }
    }`,
      { spec: JSON.stringify({ keys: ['_step'], minStep: 0, maxStep: 1, samples: 2 }) },
    )
    assert.deepEqual(boundaries.data, {
      project: {
        run: {
          history: [],
          sampledHistory: [[{ _step: 0 }, { _step: 1 }]],
          parquetHistory: {
            parquetUrls: [],
            liveData: [{ _step: 0 }, { _step: 1 }, { _step: 4 }, { _step: 5 }],
          },
        },
      },
    })
    const page = await query(
      '{ project(entityName:"lab",name:"experiments") { runs(after:"cursor:1",first:1) { totalCount pageInfo { startCursor endCursor hasPreviousPage hasNextPage } } } }',
    )
    assert.deepEqual(page.data, {
      project: {
        runs: {
          totalCount: 3,
          pageInfo: {
            startCursor: 'cursor:2',
            endCursor: 'cursor:2',
            hasPreviousPage: true,
            hasNextPage: true,
          },
        },
      },
    })
    const named = await fetch(server.base + '/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: 'query First { viewer { username } } query Second { viewer { entity } }',
        operationName: 'Second',
      }),
    })
    assert.deepEqual(await named.json(), { data: { viewer: { entity: 'lab' } } })
    for (const variables of [{ spec: {} }, { spec: true }]) {
      const invalidScalar = await query(
        'query($spec:JSONString!){ project(entityName:"lab",name:"experiments"){runCount(filters:$spec)} }',
        variables,
      )
      assert(invalidScalar.errors?.length)
    }
    for (const value of ['2', true, {}]) {
      const invalidScalar = await query(
        'query($step:Int64){project(entityName:"lab",name:"experiments"){run(name:"run-a"){history(minStep:$step)}}}',
        { step: value },
      )
      assert(invalidScalar.errors?.length)
    }
    const badQuery = await fetch(server.base + '/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: '{ unknownField }' }),
    })
    assert.equal(badQuery.status, 400)
    const badOperation = await fetch(server.base + '/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'query Named { viewer { id } }', operationName: 'Missing' }),
    })
    assert.equal(badOperation.status, 500)
    for (const source of [
      '{ project(entityName:"lab", name:"experiments") { run(name:"run-a") { history(samples:1) } } }',

      '{ unknownField }',
      'mutation { deleteRun(id:"run-a") }',
      '{ project(entityName:"lab",name:"experiments") { run(name:"run-a") { files(pattern:"*.txt") { edges { node { name } } } } } }',
      '{ project(entityName:"lab",name:"experiments") { run(name:"run-a") { files { edges { node { url(upload:true) } } } } } }',
    ])
      assert((await query(source)).errors?.length, source)
  } finally {
    await server.close()
  }
}
