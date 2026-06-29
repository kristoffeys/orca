import type {
  ProductiveComment,
  ProductiveConnectArgs,
  ProductiveConnectionStatus,
  ProductiveCreateTaskArgs,
  ProductivePerson,
  ProductiveProject,
  ProductiveTask,
  ProductiveTaskFilter,
  ProductiveTaskList,
  ProductiveTaskUpdate,
  ProductiveWorkflowStatus
} from '../../shared/productive-types'

export type ProductiveApi = {
  connect: (args: ProductiveConnectArgs) => Promise<{ ok: true } | { ok: false; error: string }>
  disconnect: () => Promise<void>
  status: () => Promise<ProductiveConnectionStatus>
  testConnection: () => Promise<{ ok: true } | { ok: false; error: string }>
  searchTasks: (args: { query: string; limit?: number }) => Promise<ProductiveTask[]>
  listTasks: (args?: {
    filter?: ProductiveTaskFilter
    limit?: number
    projectIds?: string[]
  }) => Promise<ProductiveTask[]>
  getTask: (args: { taskId: string }) => Promise<ProductiveTask | null>
  createTask: (
    args: ProductiveCreateTaskArgs
  ) => Promise<{ ok: true; id: string; url: string } | { ok: false; error: string }>
  updateTask: (args: {
    taskId: string
    updates: ProductiveTaskUpdate
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  addTaskComment: (args: {
    taskId: string
    body: string
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  taskComments: (args: { taskId: string }) => Promise<ProductiveComment[]>
  listProjects: () => Promise<ProductiveProject[]>
  listTaskLists: (args: { projectId: string }) => Promise<ProductiveTaskList[]>
  listWorkflowStatuses: () => Promise<ProductiveWorkflowStatus[]>
  listAssignablePeople: (args?: { query?: string }) => Promise<ProductivePerson[]>
}
