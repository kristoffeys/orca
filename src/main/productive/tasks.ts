/* eslint-disable max-lines -- Why: Productive task reads and mutations share the
   JSON:API included[] resolution, link-based pagination, and auth-clearing
   behavior; keeping the API boundary together avoids drift between operations. */
import type {
  ProductiveComment,
  ProductiveCreateTaskArgs,
  ProductiveCreateTaskResult,
  ProductiveMutationResult,
  ProductivePerson,
  ProductiveProject,
  ProductiveRecord,
  ProductiveTask,
  ProductiveTaskFilter,
  ProductiveTaskList,
  ProductiveTaskUpdate,
  ProductiveWorkflowStatus
} from '../../shared/productive-types'
import {
  acquire,
  clearToken,
  getClient,
  isAuthError,
  productiveRequest,
  release,
  type ProductiveClient
} from './client'
import {
  asRecord,
  asString,
  buildIncludedLookup,
  mapComment,
  mapPerson,
  mapProductiveTask,
  mapProject,
  mapTaskList,
  mapWorkflowStatus,
  markdownToBody,
  taskUrl
} from './mapper'

// Why: "me" reads filter on the configured viewer; the assigned/done filters key
// off the workflow_status category (1/2 = open universe, 3 = closed) rather than
// a Jira-style resolution field.
const TASK_INCLUDE = 'project,assignee,workflow_status'

type JsonApiResponse = {
  data?: ProductiveRecord | ProductiveRecord[]
  included?: unknown
  links?: { next?: string | null }
  meta?: ProductiveRecord
}

function clampLimit(limit: number | undefined, fallback = 30): number {
  return Math.min(Math.max(1, Number.isFinite(limit) ? Number(limit) : fallback), 100)
}

function asDataArray(value: unknown): ProductiveRecord[] {
  if (Array.isArray(value)) {
    return value.map((item) => asRecord(item))
  }
  return []
}

/** Pull `page[number]` from a Productive `links.next` URL (absolute or relative),
 *  returning null when there is no further page. */
function nextPageNumber(links: JsonApiResponse['links']): number | null {
  const next = links?.next
  if (typeof next !== 'string' || !next) {
    return null
  }
  try {
    // Why: links.next may be absolute (with host) or a bare query string; the
    // base only matters for parsing, never for the issued request.
    const url = new URL(next, 'https://api.productive.io')
    const raw = url.searchParams.get('page[number]') ?? url.searchParams.get('page%5Bnumber%5D')
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

/** Fetch every page of a JSON:API collection, accumulating `data[]` records and a
 *  merged `included[]` lookup keyed by {type,id}. Paginates via links.next /
 *  page[number] (NOT Jira's startAt/maxResults). */
async function fetchPagedCollection(
  client: ProductiveClient,
  buildPath: (page: number, pageSize: number) => string,
  pageSize = 100
): Promise<{ records: ProductiveRecord[]; included: ProductiveRecord[] }> {
  const records: ProductiveRecord[] = []
  const included: ProductiveRecord[] = []
  let page = 1
  for (let guard = 0; guard < 100; guard += 1) {
    const response = await productiveRequest<JsonApiResponse>(client, buildPath(page, pageSize))
    records.push(...asDataArray(response?.data))
    included.push(...asDataArray(response?.included))
    const next = nextPageNumber(response?.links)
    if (next === null) {
      break
    }
    page = next
  }
  return { records, included }
}

function withPageParams(path: string, page: number, pageSize: number): string {
  const separator = path.includes('?') ? '&' : '?'
  const params = new URLSearchParams()
  params.set('page[number]', String(page))
  params.set('page[size]', String(pageSize))
  return `${path}${separator}${params.toString()}`
}

function sortAndLimitTasks(tasks: ProductiveTask[], limit: number): ProductiveTask[] {
  return tasks
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
}

/** Analog of Jira's filterToJql: translate an Orca filter into Productive
 *  `filter[...]` query params. category 1+2 = open universe, 3 = closed. */
// Why: Productive's task `status` filter expects an INTEGER, not a string —
// 1 = open, 2 = closed. (Passing 'open'/'closed' returns a 400 "Expected a value
// of type 'Integer'".)
const PRODUCTIVE_STATUS_OPEN = '1'
const PRODUCTIVE_STATUS_CLOSED = '2'

function filterToProductiveQuery(filter: ProductiveTaskFilter, client: ProductiveClient): string {
  const params = new URLSearchParams()
  params.set('sort', '-updated_at')
  if (filter === 'assigned') {
    params.set('filter[assignee_id]', client.viewerId)
    params.set('filter[status]', PRODUCTIVE_STATUS_OPEN)
  } else if (filter === 'reported') {
    params.set('filter[creator_id]', client.viewerId)
    params.set('filter[status]', PRODUCTIVE_STATUS_OPEN)
  } else if (filter === 'done') {
    params.set('filter[assignee_id]', client.viewerId)
    params.set('filter[status]', PRODUCTIVE_STATUS_CLOSED)
  } else {
    params.set('filter[status]', PRODUCTIVE_STATUS_OPEN)
  }
  return params.toString()
}

export async function listTasks(
  filter: ProductiveTaskFilter = 'assigned',
  limit = 30,
  projectIds?: string[]
): Promise<ProductiveTask[]> {
  const client = getClient()
  if (!client) {
    return []
  }
  const safeLimit = clampLimit(limit)
  await acquire()
  try {
    let query = filterToProductiveQuery(filter, client)
    // Why: Productive accepts comma-separated ids for a JSON:API filter; if the
    // multi-id form is unsupported it degrades to the first id, which is acceptable.
    if (projectIds && projectIds.length > 0) {
      const params = new URLSearchParams()
      params.set('filter[project_id]', projectIds.join(','))
      query = `${query}&${params.toString()}`
    }
    const { records, included } = await fetchPagedCollection(client, (page, pageSize) =>
      withPageParams(`/tasks?${query}&include=${TASK_INCLUDE}`, page, pageSize)
    )
    const tasks = records.map((record) =>
      mapProductiveTask(client.organizationId, record, included)
    )
    return sortAndLimitTasks(tasks, safeLimit)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    throw error
  } finally {
    release()
  }
}

export async function searchTasks(query: string, limit = 30): Promise<ProductiveTask[]> {
  const client = getClient()
  if (!client || !query.trim()) {
    return []
  }
  const safeLimit = clampLimit(limit)
  await acquire()
  try {
    const params = new URLSearchParams()
    params.set('filter[query]', query.trim())
    params.set('sort', '-updated_at')
    const { records, included } = await fetchPagedCollection(client, (page, pageSize) =>
      withPageParams(`/tasks?${params.toString()}&include=${TASK_INCLUDE}`, page, pageSize)
    )
    const tasks = records.map((record) =>
      mapProductiveTask(client.organizationId, record, included)
    )
    return sortAndLimitTasks(tasks, safeLimit)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    throw error
  } finally {
    release()
  }
}

export async function getTask(taskId: string): Promise<ProductiveTask | null> {
  const client = getClient()
  if (!client) {
    return null
  }
  await acquire()
  try {
    const response = await productiveRequest<JsonApiResponse>(
      client,
      `/tasks/${encodeURIComponent(taskId)}?include=${TASK_INCLUDE}`
    )
    if (!response || Array.isArray(response.data) || !response.data) {
      return null
    }
    return mapProductiveTask(client.organizationId, response.data, response.included)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    console.warn('[productive] getTask failed:', error)
    return null
  } finally {
    release()
  }
}

export async function createTask(
  args: ProductiveCreateTaskArgs
): Promise<ProductiveCreateTaskResult> {
  const client = getClient()
  if (!client) {
    return { ok: false, error: 'Not connected to Productive.' }
  }
  const title = args.title.trim()
  if (!title) {
    return { ok: false, error: 'Title is required.' }
  }
  if (!args.projectId) {
    return { ok: false, error: 'A project is required.' }
  }

  await acquire()
  try {
    const attributes: ProductiveRecord = { title }
    if (args.description?.trim()) {
      attributes.description = markdownToBody(args.description.trim())
    }
    const relationships: ProductiveRecord = {
      project: { data: { type: 'projects', id: args.projectId } }
    }
    if (args.taskListId) {
      relationships.task_list = { data: { type: 'task_lists', id: args.taskListId } }
    }
    if (args.assigneeId) {
      relationships.assignee = { data: { type: 'people', id: args.assigneeId } }
    }
    const response = await productiveRequest<JsonApiResponse>(client, '/tasks', {
      method: 'POST',
      body: JSON.stringify({ data: { type: 'tasks', attributes, relationships } })
    })
    const data = response && !Array.isArray(response.data) ? asRecord(response.data) : {}
    const id = asString(data.id)
    return {
      ok: true,
      id,
      url: taskUrl(client.organizationId, { id, projectId: args.projectId })
    }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to create task.' }
  } finally {
    release()
  }
}

export async function updateTask(
  taskId: string,
  updates: ProductiveTaskUpdate
): Promise<ProductiveMutationResult> {
  const client = getClient()
  if (!client) {
    return { ok: false, error: 'Not connected to Productive.' }
  }
  await acquire()
  try {
    const attributes: ProductiveRecord = {}
    if (updates.title !== undefined) {
      attributes.title = updates.title
    }
    if (updates.description !== undefined) {
      attributes.description = updates.description ? markdownToBody(updates.description) : ''
    }
    const relationships: ProductiveRecord = {}
    if (updates.assigneeId !== undefined) {
      // Why: status and assignee changes both flow through the JSON:API
      // relationships block on PATCH /tasks/{id}, replacing Jira's dedicated
      // assignee + transitions endpoints.
      relationships.assignee = updates.assigneeId
        ? { data: { type: 'people', id: updates.assigneeId } }
        : { data: null }
    }
    if (updates.workflowStatusId !== undefined) {
      relationships.workflow_status = updates.workflowStatusId
        ? { data: { type: 'workflow_statuses', id: updates.workflowStatusId } }
        : { data: null }
    }
    const data: ProductiveRecord = { type: 'tasks', id: taskId }
    if (Object.keys(attributes).length > 0) {
      data.attributes = attributes
    }
    if (Object.keys(relationships).length > 0) {
      data.relationships = relationships
    }
    if (!data.attributes && !data.relationships) {
      return { ok: true }
    }
    await productiveRequest(client, `/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ data })
    })
    return { ok: true }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to update task.' }
  } finally {
    release()
  }
}

export async function addTaskComment(
  taskId: string,
  body: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const client = getClient()
  if (!client) {
    return { ok: false, error: 'Not connected to Productive.' }
  }
  await acquire()
  try {
    const response = await productiveRequest<JsonApiResponse>(client, '/comments', {
      method: 'POST',
      body: JSON.stringify({
        data: {
          type: 'comments',
          attributes: { body: markdownToBody(body) },
          relationships: { task: { data: { type: 'tasks', id: taskId } } }
        }
      })
    })
    const data = response && !Array.isArray(response.data) ? asRecord(response.data) : {}
    return { ok: true, id: asString(data.id) }
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to add comment.' }
  } finally {
    release()
  }
}

export async function getTaskComments(taskId: string): Promise<ProductiveComment[]> {
  const client = getClient()
  if (!client) {
    return []
  }
  await acquire()
  try {
    const { records, included } = await fetchPagedCollection(client, (page, pageSize) =>
      withPageParams(
        `/comments?filter[task_id]=${encodeURIComponent(taskId)}&include=creator&sort=created_at`,
        page,
        pageSize
      )
    )
    const lookup = buildIncludedLookup(included)
    return records.map((record) => mapComment(record, lookup))
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    console.warn('[productive] getTaskComments failed:', error)
    return []
  } finally {
    release()
  }
}

export async function listProjects(): Promise<ProductiveProject[]> {
  const client = getClient()
  if (!client) {
    return []
  }
  await acquire()
  try {
    const { records } = await fetchPagedCollection(client, (page, pageSize) =>
      withPageParams('/projects?filter[status]=1&sort=name', page, pageSize)
    )
    return records.map(mapProject).sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    console.warn('[productive] listProjects failed:', error)
    return []
  } finally {
    release()
  }
}

export async function listTaskLists(projectId: string): Promise<ProductiveTaskList[]> {
  const client = getClient()
  if (!client || !projectId) {
    return []
  }
  await acquire()
  try {
    const { records } = await fetchPagedCollection(client, (page, pageSize) =>
      withPageParams(
        `/task_lists?filter[project_id]=${encodeURIComponent(projectId)}&sort=position`,
        page,
        pageSize
      )
    )
    return records.map(mapTaskList)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    console.warn('[productive] listTaskLists failed:', error)
    return []
  } finally {
    release()
  }
}

export async function listWorkflowStatuses(): Promise<ProductiveWorkflowStatus[]> {
  const client = getClient()
  if (!client) {
    return []
  }
  await acquire()
  try {
    const { records } = await fetchPagedCollection(client, (page, pageSize) =>
      withPageParams('/workflow_statuses', page, pageSize)
    )
    return records.map(mapWorkflowStatus)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    console.warn('[productive] listWorkflowStatuses failed:', error)
    return []
  } finally {
    release()
  }
}

export async function listAssignablePeople(query?: string): Promise<ProductivePerson[]> {
  const client = getClient()
  if (!client) {
    return []
  }
  await acquire()
  try {
    const params = new URLSearchParams()
    // Why: only active, non-virtual members are assignable; mirror the Jira
    // assignable-user filter intent without Jira's per-issue endpoint.
    params.set('filter[status]', '1')
    if (query?.trim()) {
      params.set('filter[query]', query.trim())
    }
    const { records } = await fetchPagedCollection(client, (page, pageSize) =>
      withPageParams(`/people?${params.toString()}`, page, pageSize)
    )
    return records
      .map((record) => mapPerson(record))
      .filter((person): person is ProductivePerson => person !== undefined)
  } catch (error) {
    if (isAuthError(error)) {
      clearToken()
      throw error
    }
    console.warn('[productive] listAssignablePeople failed:', error)
    return []
  } finally {
    release()
  }
}

export { taskUrl } from './mapper'
