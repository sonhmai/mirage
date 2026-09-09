import { buildSchema, GraphQLError, GraphQLScalarType, Kind } from 'graphql'

export const schema = buildSchema(`
 scalar Int64
 scalar DateTime
 scalar JSONString
 scalar JSON
 type PageInfo { endCursor: String, hasNextPage: Boolean!, startCursor: String, hasPreviousPage: Boolean! }
 type ProjectEdge { node: Project, cursor: String! }
 type ProjectConnection { edges: [ProjectEdge!]!, pageInfo: PageInfo! }
 type RunEdge { node: Run!, cursor: String! }
 type RunConnection { edges: [RunEdge!]!, pageInfo: PageInfo!, totalCount: Int! }
 type FileEdge { node: File, cursor: String! }
 type FileConnection { edges: [FileEdge!]!, pageInfo: PageInfo!, totalCount: Int! }
 type Entity { name: String! }
 type EntityEdge { node: Entity }
 type EntityConnection { edges: [EntityEdge!]! }
 type ApiKey { id: ID!, name: String!, description: String }
 type ApiKeyEdge { node: ApiKey }
 type ApiKeyConnection { edges: [ApiKeyEdge!]! }
 type User { id: ID!, name: String!, username: String, email: String, entity: String,
  admin: Boolean, flags: JSONString, deletedAt: DateTime, teams: EntityConnection, apiKeys: ApiKeyConnection }
 type File { id: ID!, name: String!, url(upload: Boolean): String, directUrl: String!, sizeBytes: Int64!, mimetype: String, updatedAt: DateTime, md5: String }
 type Sweep { id: ID!, name: String!, displayName: String, state: String!, runCountExpected: Int, bestLoss: Float, config: String!, method: String!, description: String, createdAt: DateTime!, updatedAt: DateTime, runCount: Int! }
 type ParquetHistory { parquetUrls: [String!]!, liveData: [JSON!]! }
 type Run { id: ID!, projectId: ID!, name: String!, displayName: String, state: String, config: JSONString, summaryMetrics: JSONString, historyKeys: JSON, historyLineCount: Int, fileCount: Int, tags: [String!], createdAt: DateTime!, notes: String,
  sweepName: String, group: String, jobType: String, commit: String, readOnly: Boolean,
  heartbeatAt: DateTime, description: String, user: User, systemMetrics: JSONString,
  history(minStep: Int64, maxStep: Int64, samples: Int): [String!]!,
  sampledHistory(specs: [JSONString!]!): [JSON!]!,
  parquetHistory(liveKeys: [String!]!): ParquetHistory!,
  files(after: String, first: Int, names: [String], pattern: String): FileConnection
 }
 type Project { id: ID!, internalId: ID!, name: String!, entityName: String!, createdAt: DateTime!, isBenchmark: Boolean!, description: String, readOnly: Boolean, user: User,
  runCount(filters: JSONString): Int!, runs(after: String, first: Int, order: String, filters: JSONString): RunConnection,
  run(name: String!): Run, sweep(sweepName: String!): Sweep }
 type Query { models(entityName: String, after: String, first: Int): ProjectConnection, project(name: String, entityName: String): Project, viewer: User }
`)

function int64(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new GraphQLError('Int64 requires a number')
  const integer = Math.trunc(value)
  if (!Number.isSafeInteger(integer)) throw new GraphQLError('Int64 exceeds fixture precision')
  return integer
}
function jsonString(value: unknown): string {
  if (typeof value !== 'string') throw new GraphQLError('JSONString requires a string')
  return value
}
const intType = schema.getType('Int64')
if (intType instanceof GraphQLScalarType) {
  intType.serialize = int64
  intType.parseValue = int64
  intType.parseLiteral = (node) => {
    if (node.kind !== Kind.INT && node.kind !== Kind.FLOAT)
      throw new GraphQLError('Int64 requires a number')
    return int64(Number(node.value))
  }
}
const jsonType = schema.getType('JSONString')
if (jsonType instanceof GraphQLScalarType) {
  jsonType.serialize = jsonString
  jsonType.parseValue = jsonString
  jsonType.parseLiteral = (node) => {
    if (node.kind !== Kind.STRING) throw new GraphQLError('JSONString requires a string')
    return node.value
  }
}
