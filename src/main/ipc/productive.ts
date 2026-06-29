import { ipcMain } from 'electron'
import { connect, disconnect, getStatus, testConnection } from '../productive/client'
import {
  addTaskComment,
  createTask,
  getTask,
  getTaskComments,
  listAssignablePeople,
  listProjects,
  listTaskLists,
  listTasks,
  listWorkflowStatuses,
  searchTasks,
  updateTask
} from '../productive/tasks'
import { _resetPreflightCache } from './preflight'
import type {
  ProductiveConnectArgs,
  ProductiveCreateTaskArgs,
  ProductiveTaskFilter,
  ProductiveTaskUpdate
} from '../../shared/productive-types'

const VALID_FILTERS = new Set<ProductiveTaskFilter>(['assigned', 'reported', 'all', 'done'])

function clampLimit(value: unknown, fallback = 30): number {
  const limit = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(Math.max(1, limit), 100)
}

function normalizeTaskUpdate(value: unknown): ProductiveTaskUpdate | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const input = value as ProductiveTaskUpdate
  if (input.title !== undefined && typeof input.title !== 'string') {
    return null
  }
  if (
    input.description !== undefined &&
    input.description !== null &&
    typeof input.description !== 'string'
  ) {
    return null
  }
  if (
    input.assigneeId !== undefined &&
    input.assigneeId !== null &&
    typeof input.assigneeId !== 'string'
  ) {
    return null
  }
  if (
    input.workflowStatusId !== undefined &&
    input.workflowStatusId !== null &&
    typeof input.workflowStatusId !== 'string'
  ) {
    return null
  }
  return input
}

export function registerProductiveHandlers(): void {
  ipcMain.handle('productive:connect', async (_event, args: ProductiveConnectArgs) => {
    if (typeof args?.apiToken !== 'string' || typeof args?.organizationId !== 'string') {
      return { ok: false, error: 'API token and organization id are required.' }
    }
    const result = await connect({
      apiToken: args.apiToken,
      organizationId: args.organizationId,
      ...(typeof args.personId === 'string' ? { personId: args.personId } : {})
    })
    if (result.ok) {
      _resetPreflightCache()
    }
    return result
  })

  ipcMain.handle('productive:disconnect', async () => {
    disconnect()
    _resetPreflightCache()
  })

  ipcMain.handle('productive:status', async () => {
    return getStatus()
  })

  ipcMain.handle('productive:testConnection', async () => {
    return testConnection()
  })

  ipcMain.handle(
    'productive:searchTasks',
    async (_event, args: { query: string; limit?: number }) => {
      if (typeof args?.query !== 'string') {
        return []
      }
      return searchTasks(args.query, clampLimit(args.limit))
    }
  )

  ipcMain.handle(
    'productive:listTasks',
    async (
      _event,
      args?: { filter?: ProductiveTaskFilter; limit?: number; projectIds?: string[] }
    ) => {
      const filter = VALID_FILTERS.has(args?.filter as ProductiveTaskFilter)
        ? (args!.filter as ProductiveTaskFilter)
        : undefined
      const projectIds =
        Array.isArray(args?.projectIds) && args.projectIds.every((id) => typeof id === 'string')
          ? args.projectIds
          : undefined
      return listTasks(filter, clampLimit(args?.limit), projectIds)
    }
  )

  ipcMain.handle('productive:getTask', async (_event, args: { taskId: string }) => {
    if (typeof args?.taskId !== 'string' || !args.taskId.trim()) {
      return null
    }
    return getTask(args.taskId.trim())
  })

  ipcMain.handle('productive:createTask', async (_event, args: ProductiveCreateTaskArgs) => {
    if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
      return { ok: false, error: 'Project is required.' }
    }
    if (typeof args?.title !== 'string' || !args.title.trim()) {
      return { ok: false, error: 'Title is required.' }
    }
    return createTask({
      projectId: args.projectId.trim(),
      taskListId:
        typeof args.taskListId === 'string' && args.taskListId.trim()
          ? args.taskListId.trim()
          : undefined,
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      assigneeId:
        typeof args.assigneeId === 'string' && args.assigneeId.trim()
          ? args.assigneeId.trim()
          : undefined
    })
  })

  ipcMain.handle(
    'productive:updateTask',
    async (_event, args: { taskId: string; updates: ProductiveTaskUpdate }) => {
      if (typeof args?.taskId !== 'string' || !args.taskId.trim()) {
        return { ok: false, error: 'Task id is required.' }
      }
      const updates = normalizeTaskUpdate(args.updates)
      if (!updates) {
        return { ok: false, error: 'Updates object is required.' }
      }
      return updateTask(args.taskId.trim(), updates)
    }
  )

  ipcMain.handle(
    'productive:addTaskComment',
    async (_event, args: { taskId: string; body: string }) => {
      if (typeof args?.taskId !== 'string' || !args.taskId.trim()) {
        return { ok: false, error: 'Task id is required.' }
      }
      if (typeof args?.body !== 'string' || !args.body.trim()) {
        return { ok: false, error: 'Comment body is required.' }
      }
      return addTaskComment(args.taskId.trim(), args.body.trim())
    }
  )

  ipcMain.handle('productive:taskComments', async (_event, args: { taskId: string }) => {
    if (typeof args?.taskId !== 'string' || !args.taskId.trim()) {
      return []
    }
    return getTaskComments(args.taskId.trim())
  })

  ipcMain.handle('productive:listProjects', async () => {
    return listProjects()
  })

  ipcMain.handle('productive:listTaskLists', async (_event, args: { projectId: string }) => {
    if (typeof args?.projectId !== 'string' || !args.projectId.trim()) {
      return []
    }
    return listTaskLists(args.projectId.trim())
  })

  ipcMain.handle('productive:listWorkflowStatuses', async () => {
    return listWorkflowStatuses()
  })

  ipcMain.handle('productive:listAssignablePeople', async (_event, args?: { query?: string }) => {
    const query = typeof args?.query === 'string' ? args.query : undefined
    return listAssignablePeople(query)
  })
}
