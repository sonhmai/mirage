export const PROJECTS = `query Projects($entity: String!, $cursor: String,
 $perPage: Int!) {
 models(entityName: $entity, after: $cursor, first: $perPage) {
 edges { node { name } cursor } pageInfo { endCursor hasNextPage }
 }}`

export const RUNS = `query Runs($entity: String!, $project: String!, $cursor: String,
 $perPage: Int!) {
 project(name: $project, entityName: $entity) {
 runs(after: $cursor, first: $perPage, order: "+name") {
 edges { node { name } cursor } pageInfo { endCursor hasNextPage }
 }}}`

export const RUN = `query Run($entity: String!, $project: String!, $run: String!) {
 project(name: $project, entityName: $entity) { run(name: $run) {
 id name displayName state tags sweepName group jobType commit readOnly
 createdAt heartbeatAt description notes user { id name username email }
 systemMetrics historyLineCount historyKeys fileCount
 }}}`

export const RUN_EXISTS = `query RunExists($entity: String!, $project: String!,
 $run: String!) {
 project(name: $project, entityName: $entity) { run(name: $run) { name } }}`

export const RUN_CONFIG = `query RunConfig($entity: String!, $project: String!,
 $run: String!) {
 project(name: $project, entityName: $entity) { run(name: $run) {
 name config
 }}}`

export const RUN_SUMMARY = `query RunSummary($entity: String!, $project: String!,
 $run: String!) {
 project(name: $project, entityName: $entity) { run(name: $run) {
 name summaryMetrics
 }}}`

export const HISTORY_KEYS = `query HistoryKeys($entity: String!, $project: String!,
 $run: String!) {
 project(name: $project, entityName: $entity) { run(name: $run) {
 name historyKeys
 }}}`

export const FILES = `query RunFiles($entity: String!, $project: String!,
 $run: String!, $cursor: String,
 $perPage: Int!) {
 project(name: $project, entityName: $entity) { run(name: $run) {
 files(after: $cursor, first: $perPage) {
 edges { node { name sizeBytes } cursor }
 pageInfo { endCursor hasNextPage }
 }}}}`

export const FILE = `query RunFile($entity: String!, $project: String!,
 $run: String!, $names: [String!]!) {
 project(name: $project, entityName: $entity) { run(name: $run) {
 files(names: $names, first: 1) {
 edges { node { name directUrl url(upload: false) sizeBytes } }
 }}}}`

export const HISTORY = `query HistoryPage($entity: String!, $project: String!,
 $run: String!, $minStep: Int64!,
 $maxStep: Int64!, $pageSize: Int!) {
 project(name: $project, entityName: $entity) { run(name: $run) {
 history(minStep: $minStep, maxStep: $maxStep, samples: $pageSize)
 }}}`
