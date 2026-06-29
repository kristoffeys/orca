import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import {
  OptionalFiniteNumber,
  OptionalPlainString,
  OptionalString,
  requiredString
} from '../schemas'

const VALID_FILTERS = ['assigned', 'reported', 'all', 'done'] as const

const Connect = z.object({
  apiToken: requiredString('API token is required'),
  organizationId: requiredString('Organization id is required'),
  personId: OptionalString
})

const SearchTasks = z.object({
  query: requiredString('Missing query'),
  limit: OptionalFiniteNumber
})

const ListTasks = z
  .object({
    filter: z.enum(VALID_FILTERS).optional(),
    limit: OptionalFiniteNumber,
    projectIds: z.array(z.string()).optional()
  })
  .optional()

const TaskId = z.object({
  taskId: requiredString('Task id is required')
})

const CreateTask = z.object({
  projectId: requiredString('Project is required'),
  taskListId: OptionalString,
  title: requiredString('Title is required'),
  description: OptionalPlainString,
  assigneeId: OptionalString
})

const TaskUpdate = z.object({
  taskId: requiredString('Task id is required'),
  updates: z.object({
    title: OptionalString,
    description: z.union([z.string(), z.null()]).optional(),
    assigneeId: z.union([z.string(), z.null()]).optional(),
    workflowStatusId: z.union([z.string(), z.null()]).optional()
  })
})

const TaskComment = z.object({
  taskId: requiredString('Task id is required'),
  body: requiredString('Comment body is required')
})

const ProjectId = z.object({
  projectId: requiredString('Project is required')
})

const AssignablePeople = z
  .object({
    query: OptionalPlainString
  })
  .optional()

export const PRODUCTIVE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'productive.connect',
    params: Connect,
    handler: async (params, { runtime }) =>
      runtime.productiveConnect({
        apiToken: params.apiToken.trim(),
        organizationId: params.organizationId.trim(),
        ...(params.personId ? { personId: params.personId.trim() } : {})
      })
  }),
  defineMethod({
    name: 'productive.disconnect',
    params: null,
    handler: async (_params, { runtime }) => runtime.productiveDisconnect()
  }),
  defineMethod({
    name: 'productive.status',
    params: null,
    handler: async (_params, { runtime }) => runtime.productiveStatus()
  }),
  defineMethod({
    name: 'productive.testConnection',
    params: null,
    handler: async (_params, { runtime }) => runtime.productiveTestConnection()
  }),
  defineMethod({
    name: 'productive.searchTasks',
    params: SearchTasks,
    handler: async (params, { runtime }) =>
      runtime.productiveSearchTasks(params.query.trim(), params.limit)
  }),
  defineMethod({
    name: 'productive.listTasks',
    params: ListTasks,
    handler: async (params, { runtime }) =>
      runtime.productiveListTasks(params?.filter, params?.limit, params?.projectIds)
  }),
  defineMethod({
    name: 'productive.getTask',
    params: TaskId,
    handler: async (params, { runtime }) => runtime.productiveGetTask(params.taskId.trim())
  }),
  defineMethod({
    name: 'productive.createTask',
    params: CreateTask,
    handler: async (params, { runtime }) =>
      runtime.productiveCreateTask({
        projectId: params.projectId.trim(),
        taskListId: params.taskListId,
        title: params.title.trim(),
        description: params.description?.trim() || undefined,
        assigneeId: params.assigneeId
      })
  }),
  defineMethod({
    name: 'productive.updateTask',
    params: TaskUpdate,
    handler: async (params, { runtime }) =>
      runtime.productiveUpdateTask(params.taskId.trim(), params.updates)
  }),
  defineMethod({
    name: 'productive.addTaskComment',
    params: TaskComment,
    handler: async (params, { runtime }) =>
      runtime.productiveAddTaskComment(params.taskId.trim(), params.body.trim())
  }),
  defineMethod({
    name: 'productive.taskComments',
    params: TaskId,
    handler: async (params, { runtime }) => runtime.productiveTaskComments(params.taskId.trim())
  }),
  defineMethod({
    name: 'productive.listProjects',
    params: null,
    handler: async (_params, { runtime }) => runtime.productiveListProjects()
  }),
  defineMethod({
    name: 'productive.listTaskLists',
    params: ProjectId,
    handler: async (params, { runtime }) => runtime.productiveListTaskLists(params.projectId.trim())
  }),
  defineMethod({
    name: 'productive.listWorkflowStatuses',
    params: null,
    handler: async (_params, { runtime }) => runtime.productiveListWorkflowStatuses()
  }),
  defineMethod({
    name: 'productive.listAssignablePeople',
    params: AssignablePeople,
    handler: async (params, { runtime }) => runtime.productiveListAssignablePeople(params?.query)
  })
]
