import type {
  ProductiveComment,
  ProductiveConnectArgs,
  ProductiveConnectionStatus,
  ProductiveCreateTaskArgs,
  ProductiveCreateTaskResult,
  ProductivePerson,
  ProductiveProject,
  ProductiveTask,
  ProductiveTaskFilter,
  ProductiveTaskList,
  ProductiveTaskUpdate,
  ProductiveMutationResult,
  ProductiveWorkflowStatus
} from '../../../shared/productive-types'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { isRuntimeProviderSearchQueryWithinLimit } from './runtime-provider-search-bounds'

export type RuntimeProductiveSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | TaskSourceContext
  | null
  | undefined

// Why: connect/testConnection validate the credential and persist it; the viewer
// identity is read separately via productiveStatus(), matching the backend shape.
export type ProductiveConnectResult = { ok: true } | { ok: false; error: string }
export type ProductiveCommentResult = { ok: true; id: string } | { ok: false; error: string }

function isTaskSourceRuntimeSettings(
  settings: RuntimeProductiveSettings
): settings is TaskSourceContext {
  return settings !== null && settings !== undefined && 'kind' in settings
}

function getProductiveRuntimeTarget(
  settings: RuntimeProductiveSettings
): ReturnType<typeof getActiveRuntimeTarget> {
  // Why: task source context makes provider ownership explicit; legacy callers
  // still pass focused runtime settings until Tasks finishes migrating.
  return getActiveRuntimeTarget(
    isTaskSourceRuntimeSettings(settings) ? getTaskSourceRuntimeSettings(settings) : settings
  )
}

export async function productiveStatus(
  settings: RuntimeProductiveSettings
): Promise<ProductiveConnectionStatus> {
  const target = getProductiveRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveConnectionStatus>(target, 'productive.status', undefined, {
        timeoutMs: 15_000
      })
    : window.api.productive.status()
}

export async function productiveConnect(
  settings: RuntimeProductiveSettings,
  args: ProductiveConnectArgs
): Promise<ProductiveConnectResult> {
  const target = getProductiveRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveConnectResult>(target, 'productive.connect', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.connect(args)
}

export async function productiveDisconnect(settings: RuntimeProductiveSettings): Promise<void> {
  const target = getProductiveRuntimeTarget(settings)
  if (target.kind === 'environment') {
    await callRuntimeRpc<{ ok: true }>(target, 'productive.disconnect', undefined, {
      timeoutMs: 15_000
    })
    return
  }
  await window.api.productive.disconnect()
}

export async function productiveTestConnection(
  settings: RuntimeProductiveSettings
): Promise<ProductiveConnectResult> {
  const target = getProductiveRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveConnectResult>(target, 'productive.testConnection', undefined, {
        timeoutMs: 30_000
      })
    : window.api.productive.testConnection()
}

export async function productiveSearchTasks(
  settings: RuntimeProductiveSettings,
  query: string,
  limit?: number
): Promise<ProductiveTask[]> {
  if (!isRuntimeProviderSearchQueryWithinLimit(query)) {
    return []
  }
  const target = getProductiveRuntimeTarget(settings)
  const args = { query, limit }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveTask[]>(target, 'productive.searchTasks', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.searchTasks(args)
}

export async function productiveListTasks(
  settings: RuntimeProductiveSettings,
  filter?: ProductiveTaskFilter,
  limit?: number,
  projectIds?: string[]
): Promise<ProductiveTask[]> {
  const target = getProductiveRuntimeTarget(settings)
  const args = { filter, limit, projectIds }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveTask[]>(target, 'productive.listTasks', args, { timeoutMs: 30_000 })
    : window.api.productive.listTasks(args)
}

export async function productiveGetTask(
  settings: RuntimeProductiveSettings,
  taskId: string
): Promise<ProductiveTask | null> {
  const target = getProductiveRuntimeTarget(settings)
  const args = { taskId }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveTask | null>(target, 'productive.getTask', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.getTask(args)
}

export async function productiveCreateTask(
  settings: RuntimeProductiveSettings,
  args: ProductiveCreateTaskArgs
): Promise<ProductiveCreateTaskResult> {
  const target = getProductiveRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveCreateTaskResult>(target, 'productive.createTask', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.createTask(args)
}

export async function productiveUpdateTask(
  settings: RuntimeProductiveSettings,
  taskId: string,
  updates: ProductiveTaskUpdate
): Promise<ProductiveMutationResult> {
  const target = getProductiveRuntimeTarget(settings)
  const args = { taskId, updates }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveMutationResult>(target, 'productive.updateTask', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.updateTask(args)
}

export async function productiveAddTaskComment(
  settings: RuntimeProductiveSettings,
  taskId: string,
  body: string
): Promise<ProductiveCommentResult> {
  const target = getProductiveRuntimeTarget(settings)
  const args = { taskId, body }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveCommentResult>(target, 'productive.addTaskComment', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.addTaskComment(args)
}

export async function productiveTaskComments(
  settings: RuntimeProductiveSettings,
  taskId: string
): Promise<ProductiveComment[]> {
  const target = getProductiveRuntimeTarget(settings)
  const args = { taskId }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveComment[]>(target, 'productive.taskComments', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.taskComments(args)
}

export async function productiveListProjects(
  settings: RuntimeProductiveSettings
): Promise<ProductiveProject[]> {
  const target = getProductiveRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveProject[]>(target, 'productive.listProjects', undefined, {
        timeoutMs: 30_000
      })
    : window.api.productive.listProjects()
}

export async function productiveListTaskLists(
  settings: RuntimeProductiveSettings,
  projectId: string
): Promise<ProductiveTaskList[]> {
  const target = getProductiveRuntimeTarget(settings)
  const args = { projectId }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveTaskList[]>(target, 'productive.listTaskLists', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.listTaskLists(args)
}

export async function productiveListWorkflowStatuses(
  settings: RuntimeProductiveSettings
): Promise<ProductiveWorkflowStatus[]> {
  const target = getProductiveRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductiveWorkflowStatus[]>(
        target,
        'productive.listWorkflowStatuses',
        undefined,
        {
          timeoutMs: 30_000
        }
      )
    : window.api.productive.listWorkflowStatuses()
}

export async function productiveListAssignablePeople(
  settings: RuntimeProductiveSettings,
  taskId?: string | null,
  query?: string
): Promise<ProductivePerson[]> {
  if (!isRuntimeProviderSearchQueryWithinLimit(query)) {
    return []
  }
  const target = getProductiveRuntimeTarget(settings)
  const args = { taskId: taskId ?? undefined, query }
  return target.kind === 'environment'
    ? callRuntimeRpc<ProductivePerson[]>(target, 'productive.listAssignablePeople', args, {
        timeoutMs: 30_000
      })
    : window.api.productive.listAssignablePeople(args)
}
