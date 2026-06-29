import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductiveClient } from './client'

const { clearTokenMock, getClientMock, isAuthErrorMock, productiveRequestMock } = vi.hoisted(
  () => ({
    clearTokenMock: vi.fn(),
    getClientMock: vi.fn(),
    isAuthErrorMock: vi.fn(),
    productiveRequestMock: vi.fn()
  })
)

vi.mock('./client', () => ({
  acquire: vi.fn().mockResolvedValue(undefined),
  release: vi.fn(),
  clearToken: (...args: unknown[]) => clearTokenMock(...args),
  getClient: (...args: unknown[]) => getClientMock(...args),
  isAuthError: (...args: unknown[]) => isAuthErrorMock(...args),
  productiveRequest: (...args: unknown[]) => productiveRequestMock(...args)
}))

function makeClient(): ProductiveClient {
  return {
    token: 'secret-token',
    organizationId: '42',
    viewerId: '96137'
  }
}

describe('Productive task operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAuthErrorMock.mockReturnValue(false)
    getClientMock.mockReturnValue(makeClient())
  })

  it('resolves JSON:API included[] relationships when mapping a task', async () => {
    productiveRequestMock.mockResolvedValueOnce({
      data: {
        type: 'tasks',
        id: '825407',
        attributes: {
          task_number: 1,
          title: 'Wire up auth',
          description: '<p>First line<br>second line</p>',
          created_at: '2026-06-18T00:00:00.000Z',
          updated_at: '2026-06-19T00:00:00.000Z'
        },
        relationships: {
          project: { data: { type: 'projects', id: 'proj-1' } },
          assignee: { data: { type: 'people', id: 'person-1' } },
          workflow_status: { data: { type: 'workflow_statuses', id: 'ws-2' } }
        }
      },
      included: [
        { type: 'projects', id: 'proj-1', attributes: { name: 'Orca', project_number: 7 } },
        {
          type: 'people',
          id: 'person-1',
          attributes: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' }
        },
        {
          type: 'workflow_statuses',
          id: 'ws-2',
          attributes: { name: 'In progress', category_id: 2 }
        }
      ]
    })

    const { getTask } = await import('./tasks')
    const task = await getTask('825407')

    expect(task).toMatchObject({
      id: '825407',
      taskNumber: 1,
      productiveIdentifier: '#1',
      title: 'Wire up auth',
      description: 'First line\nsecond line',
      url: 'https://app.productive.io/42/task/825407',
      project: { id: 'proj-1', name: 'Orca' },
      assignee: { id: 'person-1', name: 'Ada Lovelace', email: 'ada@example.com' },
      status: { id: 'ws-2', name: 'In progress', categoryId: 2, categoryKey: 'indeterminate' }
    })
    expect(String(productiveRequestMock.mock.calls[0][1])).toContain(
      'include=project,assignee,workflow_status'
    )
  })

  it('buckets workflow status categories onto the Orca category keys', async () => {
    productiveRequestMock.mockResolvedValueOnce({
      data: [
        { type: 'workflow_statuses', id: '1', attributes: { name: 'Backlog', category_id: 1 } },
        { type: 'workflow_statuses', id: '2', attributes: { name: 'In progress', category_id: 2 } },
        { type: 'workflow_statuses', id: '3', attributes: { name: 'Closed', category_id: 3 } }
      ],
      links: { next: null }
    })

    const { listWorkflowStatuses } = await import('./tasks')

    await expect(listWorkflowStatuses()).resolves.toEqual([
      {
        id: '1',
        name: 'Backlog',
        categoryId: 1,
        categoryKey: 'new',
        categoryName: 'Not Started',
        color: undefined
      },
      {
        id: '2',
        name: 'In progress',
        categoryId: 2,
        categoryKey: 'indeterminate',
        categoryName: 'Started',
        color: undefined
      },
      {
        id: '3',
        name: 'Closed',
        categoryId: 3,
        categoryKey: 'done',
        categoryName: 'Closed',
        color: undefined
      }
    ])
  })

  it('paginates JSON:API collections via links.next + page[number]', async () => {
    productiveRequestMock
      .mockResolvedValueOnce({
        data: [{ type: 'projects', id: '2', attributes: { name: 'Bravo' } }],
        links: { next: 'https://api.productive.io/api/v2/projects?page[number]=2&page[size]=100' }
      })
      .mockResolvedValueOnce({
        data: [{ type: 'projects', id: '1', attributes: { name: 'Alpha' } }],
        links: { next: null }
      })

    const { listProjects } = await import('./tasks')

    await expect(listProjects()).resolves.toMatchObject([
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Bravo' }
    ])
    expect(productiveRequestMock).toHaveBeenCalledTimes(2)
    expect(String(productiveRequestMock.mock.calls[0][1])).toContain('page%5Bnumber%5D=1')
    expect(String(productiveRequestMock.mock.calls[1][1])).toContain('page%5Bnumber%5D=2')
  })

  it('translates list filters into Productive query params', async () => {
    productiveRequestMock.mockResolvedValue({ data: [], links: { next: null } })
    const { listTasks } = await import('./tasks')

    await listTasks('done', 20)
    const path = String(productiveRequestMock.mock.calls[0][1])
    expect(path).toContain('filter%5Bassignee_id%5D=96137')
    // Productive's task status filter is an integer (1=open, 2=closed).
    expect(path).toContain('filter%5Bstatus%5D=2')
  })

  it('sets the workflow_status relationship when updating task status', async () => {
    productiveRequestMock.mockResolvedValueOnce(null)
    const { updateTask } = await import('./tasks')

    await expect(updateTask('825407', { workflowStatusId: 'ws-3' })).resolves.toEqual({ ok: true })

    const init = productiveRequestMock.mock.calls[0][2] as { method: string; body: string }
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({
      data: {
        type: 'tasks',
        id: '825407',
        relationships: {
          workflow_status: { data: { type: 'workflow_statuses', id: 'ws-3' } }
        }
      }
    })
  })

  it('creates a task with project and optional assignee relationships', async () => {
    productiveRequestMock.mockResolvedValueOnce({
      data: { type: 'tasks', id: '900', attributes: { task_number: 5 } }
    })
    const { createTask } = await import('./tasks')

    await expect(
      createTask({
        projectId: 'proj-1',
        taskListId: 'list-1',
        title: 'New task',
        assigneeId: 'p-1'
      })
    ).resolves.toEqual({
      ok: true,
      id: '900',
      url: 'https://app.productive.io/42/task/900'
    })

    const init = productiveRequestMock.mock.calls[0][2] as { body: string }
    expect(JSON.parse(init.body).data.relationships).toEqual({
      project: { data: { type: 'projects', id: 'proj-1' } },
      task_list: { data: { type: 'task_lists', id: 'list-1' } },
      assignee: { data: { type: 'people', id: 'p-1' } }
    })
  })

  it('maps comments and resolves the creator from included[]', async () => {
    productiveRequestMock.mockResolvedValueOnce({
      data: [
        {
          type: 'comments',
          id: 'comment-1',
          attributes: {
            body: 'Looks reproducible.',
            created_at: '2026-05-30T12:00:00.000Z'
          },
          relationships: { creator: { data: { type: 'people', id: 'person-1' } } }
        }
      ],
      included: [
        {
          type: 'people',
          id: 'person-1',
          attributes: { first_name: 'Ada', last_name: 'Lovelace' }
        }
      ],
      links: { next: null }
    })

    const { getTaskComments } = await import('./tasks')

    await expect(getTaskComments('825407')).resolves.toEqual([
      {
        id: 'comment-1',
        body: 'Looks reproducible.',
        createdAt: '2026-05-30T12:00:00.000Z',
        updatedAt: undefined,
        user: { id: 'person-1', name: 'Ada Lovelace', email: undefined, avatarUrl: undefined }
      }
    ])
  })

  it('clears the credential and rethrows when a read hits an auth error', async () => {
    isAuthErrorMock.mockReturnValue(true)
    productiveRequestMock.mockRejectedValueOnce(new Error('Unauthorized'))
    const { listTasks } = await import('./tasks')

    await expect(listTasks('assigned', 20)).rejects.toThrow('Unauthorized')
    expect(clearTokenMock).toHaveBeenCalledTimes(1)
  })

  it('returns empty results when not connected', async () => {
    getClientMock.mockReturnValue(null)
    const { listTasks, listProjects, getTask } = await import('./tasks')

    await expect(listTasks('assigned')).resolves.toEqual([])
    await expect(listProjects()).resolves.toEqual([])
    await expect(getTask('1')).resolves.toBeNull()
  })
})
