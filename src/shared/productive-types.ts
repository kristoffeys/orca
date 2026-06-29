// Why: Productive is a single-organization JSON:API provider (one API token ->
// one organization), so its types collapse Jira's multi-site model into a single
// credential. Field names mirror what src/main/productive/{mapper,tasks}.ts build
// and what the renderer/runtime client consume.

export type ProductiveRecord = Record<string, unknown>

export type ProductiveViewer = {
  id: string
  name: string
  email?: string | null
  avatarUrl?: string
}

export type ProductiveConnectArgs = {
  apiToken: string
  organizationId: string
  // Optional Productive person id (Productive has no "/me" endpoint). When set,
  // it resolves the real viewer identity and powers the "assigned to me" filters.
  personId?: string
}

export type ProductiveConnectionStatus = {
  connected: boolean
  viewer: ProductiveViewer | null
  // Set when a stored token exists but could not be decrypted, so the UI can
  // explain reads failing while the connection still looks saved.
  credentialError?: string
}

export type ProductiveProject = {
  id: string
  name: string
  // Productive's per-org sequential project_number, surfaced as the human key.
  number?: number
}

export type ProductiveTaskList = {
  id: string
  name: string
  projectId?: string
}

export type ProductivePerson = {
  id: string
  name: string
  email?: string
  avatarUrl?: string
}

export type ProductiveWorkflowStatus = {
  id: string
  name: string
  // Productive category_id 1/2/3 ...
  categoryId: number
  // ... mapped onto the same keys Orca's renderer tone helpers use for Jira.
  categoryKey: string
  categoryName: string
  color?: string
}

export type ProductiveTask = {
  id: string
  // Global numeric id rendered as a number for parity with Jira's `number`.
  number: number
  // Per-project sequential counter (Productive `task_number`).
  taskNumber?: number
  // Human display identifier, e.g. "#1".
  productiveIdentifier: string
  title: string
  description: string
  url: string
  organizationId: string
  project: ProductiveProject
  taskListId?: string
  taskList?: ProductiveTaskList
  status: ProductiveWorkflowStatus
  assignee?: ProductivePerson
  createdAt: string
  updatedAt: string
}

export type ProductiveComment = {
  id: string
  body: string
  createdAt: string
  updatedAt?: string
  user?: ProductivePerson
}

export type ProductiveTaskUpdate = {
  title?: string
  description?: string | null
  assigneeId?: string | null
  workflowStatusId?: string | null
}

export type ProductiveTaskFilter = 'assigned' | 'reported' | 'all' | 'done'

export type ProductiveCreateTaskArgs = {
  projectId: string
  taskListId?: string
  title: string
  description?: string
  assigneeId?: string
}

export type ProductiveCreateTaskResult =
  | { ok: true; id: string; url: string }
  | { ok: false; error: string }

export type ProductiveMutationResult = { ok: true } | { ok: false; error: string }
