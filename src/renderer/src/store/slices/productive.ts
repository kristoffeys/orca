/* eslint-disable max-lines -- Why: the Productive slice mirrors the Jira slice
   shape (status, task caches, inflight dedup, runtime-context guards) so the
   Tasks surface behaves identically across providers. */
import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  ProductiveConnectArgs,
  ProductiveConnectionStatus,
  ProductiveProject,
  ProductiveTask,
  ProductiveTaskFilter,
  ProductiveViewer
} from '../../../../shared/productive-types'
import type { CacheEntry } from './github'
import { isIntegrationCredentialDecryptionError } from '../../../../shared/integration-credential-errors'
import {
  productiveConnect,
  productiveDisconnect,
  productiveGetTask,
  productiveListProjects,
  productiveListTasks,
  productiveSearchTasks,
  productiveStatus,
  productiveTestConnection
} from '@/runtime/runtime-productive-client'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { translate } from '@/i18n/i18n'
import {
  getTaskSourceCacheScope,
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../../shared/task-source-context'

const CACHE_TTL = 60_000
const MAX_CACHE_ENTRIES = 500

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.fetchedAt < CACHE_TTL
}

function evictStaleEntries<T>(
  cache: Record<string, CacheEntry<T>>,
  maxEntries = MAX_CACHE_ENTRIES
): Record<string, CacheEntry<T>> {
  const keys = Object.keys(cache)
  if (keys.length <= maxEntries) {
    return cache
  }
  const sorted = keys.sort((a, b) => (cache[a]?.fetchedAt ?? 0) - (cache[b]?.fetchedAt ?? 0))
  const pruned: Record<string, CacheEntry<T>> = {}
  for (const key of sorted.slice(sorted.length - maxEntries)) {
    pruned[key] = cache[key]
  }
  return pruned
}

function looksLikeAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  // Why: a 403 commonly means project/endpoint access is denied while the
  // saved token is still valid; do not flip Settings back to disconnected.
  return /authenticat|unauthorized|401/i.test(msg)
}

type InflightProductiveReadRequest<T> = {
  promise: Promise<T>
  contextKey: string
  mutationGeneration: number
}

type ProductiveReadOptions = { sourceContext?: TaskSourceContext | null }
type ProductivePatchOptions = { sourceContext?: TaskSourceContext | null }

type ProductiveReadScope = {
  settings: AppState['settings'] | TaskSourceContext | null
  contextKey: string
  cachePrefix: string | null
  explicitSource: boolean
}

const inflightTaskRequests = new Map<string, InflightProductiveReadRequest<ProductiveTask | null>>()
const inflightSearchRequests = new Map<string, InflightProductiveReadRequest<ProductiveTask[]>>()
const inflightListRequests = new Map<string, InflightProductiveReadRequest<ProductiveTask[]>>()
const inflightProjectRequests = new Map<
  string,
  InflightProductiveReadRequest<ProductiveProject[]>
>()
let productiveStatusReadGeneration = 0
let productiveMutationGeneration = 0

function clearProductiveInflight(): void {
  inflightTaskRequests.clear()
  inflightSearchRequests.clear()
  inflightListRequests.clear()
  inflightProjectRequests.clear()
}

function beginProductiveMutation(): number {
  productiveMutationGeneration += 1
  return productiveMutationGeneration
}

function isCurrentProductiveMutation(generation: number): boolean {
  return generation === productiveMutationGeneration
}

function isCurrentProductiveRuntimeContext(
  contextKey: string,
  settings: AppState['settings']
): boolean {
  return getProviderRuntimeContextKey(settings) === contextKey
}

function canWriteProductiveReadResult(
  contextKey: string,
  mutationGeneration: number,
  settings: AppState['settings'],
  explicitSource = false
): boolean {
  return (
    mutationGeneration === productiveMutationGeneration &&
    (explicitSource || isCurrentProductiveRuntimeContext(contextKey, settings))
  )
}

function getProductiveReadScope(
  settings: AppState['settings'],
  sourceContext?: TaskSourceContext | null
): ProductiveReadScope {
  if (!sourceContext) {
    return {
      settings,
      contextKey: getProviderRuntimeContextKey(settings),
      cachePrefix: null,
      explicitSource: false
    }
  }
  const runtimeSettings = getTaskSourceRuntimeSettings(sourceContext)
  return {
    settings: sourceContext,
    contextKey: `${getProviderRuntimeContextKey(runtimeSettings)}::${getTaskSourceCacheScope(sourceContext)}`,
    cachePrefix: getTaskSourceCacheScope(sourceContext),
    explicitSource: true
  }
}

function scopedProductiveCacheKey(scope: ProductiveReadScope, key: string): string {
  return scope.cachePrefix ? `${scope.cachePrefix}::${key}` : key
}

export type ProductiveSlice = {
  productiveStatus: ProductiveConnectionStatus
  productiveStatusChecked: boolean
  productiveStatusContextKey: string | null
  productiveTaskCache: Record<string, CacheEntry<ProductiveTask>>
  productiveSearchCache: Record<string, CacheEntry<ProductiveTask[]>>
  productiveProjectCache: Record<string, CacheEntry<ProductiveProject[]>>

  checkProductiveConnection: () => Promise<void>
  connectProductive: (
    args: ProductiveConnectArgs
  ) => Promise<{ ok: true; viewer: ProductiveViewer } | { ok: false; error: string }>
  testProductiveConnection: () => Promise<
    { ok: true; viewer: ProductiveViewer } | { ok: false; error: string }
  >
  disconnectProductive: () => Promise<void>
  fetchProductiveTask: (
    taskId: string,
    options?: ProductiveReadOptions
  ) => Promise<ProductiveTask | null>
  searchProductiveTasks: (
    query: string,
    limit?: number,
    options?: ProductiveReadOptions
  ) => Promise<ProductiveTask[]>
  listProductiveTasks: (
    filter?: ProductiveTaskFilter,
    limit?: number,
    options?: ProductiveReadOptions,
    projectIds?: string[]
  ) => Promise<ProductiveTask[]>
  listProductiveProjects: (options?: ProductiveReadOptions) => Promise<ProductiveProject[]>
  patchProductiveTask: (
    taskId: string,
    patch: Partial<ProductiveTask>,
    options?: ProductivePatchOptions
  ) => void
}

export const createProductiveSlice: StateCreator<AppState, [], [], ProductiveSlice> = (
  set,
  get
) => ({
  productiveStatus: { connected: false, viewer: null },
  productiveStatusChecked: false,
  productiveStatusContextKey: null,
  productiveTaskCache: {},
  productiveSearchCache: {},
  productiveProjectCache: {},

  checkProductiveConnection: async () => {
    const contextKey = getProviderRuntimeContextKey(get().settings)
    const statusReadGeneration = (productiveStatusReadGeneration += 1)
    const mutationGeneration = productiveMutationGeneration
    if (get().productiveStatusContextKey !== contextKey) {
      set({ productiveStatusChecked: false })
    }
    try {
      const status = await productiveStatus(get().settings)
      if (
        mutationGeneration !== productiveMutationGeneration ||
        statusReadGeneration !== productiveStatusReadGeneration ||
        getProviderRuntimeContextKey(get().settings) !== contextKey
      ) {
        return
      }
      const prev = get().productiveStatus
      if (
        prev.connected !== status.connected ||
        prev.credentialError !== status.credentialError ||
        prev.viewer?.email !== status.viewer?.email
      ) {
        set({
          productiveStatus: status,
          productiveStatusChecked: true,
          productiveStatusContextKey: contextKey
        })
      } else if (!get().productiveStatusChecked) {
        set({ productiveStatusChecked: true, productiveStatusContextKey: contextKey })
      } else if (get().productiveStatusContextKey !== contextKey) {
        set({ productiveStatusContextKey: contextKey })
      }
    } catch {
      if (
        mutationGeneration !== productiveMutationGeneration ||
        statusReadGeneration !== productiveStatusReadGeneration ||
        getProviderRuntimeContextKey(get().settings) !== contextKey
      ) {
        return
      }
      if (get().productiveStatus.connected) {
        set({
          productiveStatus: { connected: false, viewer: null },
          productiveStatusChecked: true,
          productiveStatusContextKey: contextKey
        })
      } else if (!get().productiveStatusChecked) {
        set({ productiveStatusChecked: true, productiveStatusContextKey: contextKey })
      } else if (get().productiveStatusContextKey !== contextKey) {
        set({ productiveStatusContextKey: contextKey })
      }
    }
  },

  connectProductive: async (args) => {
    const requestGeneration = beginProductiveMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    try {
      const result = await productiveConnect(get().settings, args)
      // Why: the connect runtime call returns ok/error; the viewer identity is
      // read back via the dedicated status call so the slice stays the single
      // source of truth for the connection viewer.
      if (
        result.ok &&
        isCurrentProductiveMutation(requestGeneration) &&
        isCurrentProductiveRuntimeContext(contextKey, get().settings)
      ) {
        const status = await productiveStatus(get().settings)
        if (
          isCurrentProductiveMutation(requestGeneration) &&
          isCurrentProductiveRuntimeContext(contextKey, get().settings)
        ) {
          set({
            productiveStatus: status,
            productiveStatusChecked: true,
            productiveStatusContextKey: contextKey
          })
        }
        return status.viewer
          ? { ok: true as const, viewer: status.viewer }
          : {
              ok: false as const,
              error: translate(
                'auto.store.slices.productive.viewermiss',
                'Connected, but could not load the Productive account.'
              )
            }
      }
      if (result.ok) {
        return {
          ok: false as const,
          error: translate(
            'auto.store.slices.productive.superseded',
            'Productive connection was superseded by a newer request.'
          )
        }
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed'
      return { ok: false as const, error: message }
    }
  },

  testProductiveConnection: async () => {
    const requestGeneration = beginProductiveMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    try {
      const result = await productiveTestConnection(get().settings)
      if (
        !isCurrentProductiveMutation(requestGeneration) ||
        !isCurrentProductiveRuntimeContext(contextKey, get().settings)
      ) {
        return result.ok
          ? {
              ok: false as const,
              error: translate(
                'auto.store.slices.productive.superseded',
                'Productive connection was superseded by a newer request.'
              )
            }
          : result
      }
      const status = await productiveStatus(get().settings)
      if (
        isCurrentProductiveMutation(requestGeneration) &&
        isCurrentProductiveRuntimeContext(contextKey, get().settings)
      ) {
        set({
          productiveStatus: status,
          productiveStatusChecked: true,
          productiveStatusContextKey: contextKey
        })
      }
      return result.ok && status.viewer
        ? { ok: true as const, viewer: status.viewer }
        : result.ok
          ? {
              ok: false as const,
              error: translate(
                'auto.store.slices.productive.viewermiss',
                'Connected, but could not load the Productive account.'
              )
            }
          : result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test failed'
      return { ok: false as const, error: message }
    }
  },

  disconnectProductive: async () => {
    const requestGeneration = beginProductiveMutation()
    const contextKey = getProviderRuntimeContextKey(get().settings)
    await productiveDisconnect(get().settings)
    if (
      !isCurrentProductiveMutation(requestGeneration) ||
      !isCurrentProductiveRuntimeContext(contextKey, get().settings)
    ) {
      return
    }
    clearProductiveInflight()
    set({
      productiveStatus: { connected: false, viewer: null },
      productiveTaskCache: {},
      productiveSearchCache: {},
      productiveProjectCache: {},
      productiveStatusChecked: true,
      productiveStatusContextKey: contextKey
    })
  },

  fetchProductiveTask: async (taskId, options) => {
    const scope = getProductiveReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const taskCacheKey = scopedProductiveCacheKey(scope, taskId)
    const cached = get().productiveTaskCache[taskCacheKey] ?? get().productiveTaskCache[taskId]
    if (isFresh(cached)) {
      return cached.data
    }
    const inflight = inflightTaskRequests.get(taskCacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === productiveMutationGeneration
    ) {
      return inflight.promise
    }
    let entry: InflightProductiveReadRequest<ProductiveTask | null>
    const requestMutationGeneration = productiveMutationGeneration
    const promise = productiveGetTask(scope.settings, taskId)
      .then((task) => {
        if (
          inflightTaskRequests.get(taskCacheKey) === entry &&
          task &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            productiveTaskCache: evictStaleEntries({
              ...s.productiveTaskCache,
              [taskCacheKey]: { data: task, fetchedAt: Date.now() }
            })
          }))
        }
        return task
      })
      .catch((error) => {
        console.warn('[productive] fetchProductiveTask failed:', error)
        if (
          looksLikeAuthError(error) &&
          !isIntegrationCredentialDecryptionError(error) &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set({ productiveStatus: { connected: false, viewer: null } })
        }
        return null
      })
      .finally(() => {
        if (inflightTaskRequests.get(taskCacheKey) === entry) {
          inflightTaskRequests.delete(taskCacheKey)
        }
      })
    entry = { promise, contextKey, mutationGeneration: requestMutationGeneration }
    inflightTaskRequests.set(taskCacheKey, entry)
    return promise
  },

  searchProductiveTasks: async (query, limit = 30, options) => {
    const scope = getProductiveReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const cacheKey = scopedProductiveCacheKey(scope, `search::${query}::${limit}`)
    const cached = get().productiveSearchCache[cacheKey]
    if (isFresh(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightSearchRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === productiveMutationGeneration
    ) {
      return inflight.promise
    }
    let entry: InflightProductiveReadRequest<ProductiveTask[]>
    const requestMutationGeneration = productiveMutationGeneration
    const promise = productiveSearchTasks(scope.settings, query, limit)
      .then((tasks) => {
        if (
          inflightSearchRequests.get(cacheKey) === entry &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            productiveSearchCache: evictStaleEntries({
              ...s.productiveSearchCache,
              [cacheKey]: { data: tasks, fetchedAt: Date.now() }
            })
          }))
        }
        return tasks
      })
      .catch((error) => {
        console.warn('[productive] searchProductiveTasks failed:', error)
        if (
          looksLikeAuthError(error) &&
          !isIntegrationCredentialDecryptionError(error) &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set({ productiveStatus: { connected: false, viewer: null } })
        }
        // Credential/auth failures are surfaced through connection state, so they
        // keep the empty-list contract. Other failures reject so the Tasks panel
        // can show a real error instead of a misleading "No tasks found".
        if (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) {
          return []
        }
        throw error
      })
      .finally(() => {
        if (inflightSearchRequests.get(cacheKey) === entry) {
          inflightSearchRequests.delete(cacheKey)
        }
      })
    entry = { promise, contextKey, mutationGeneration: requestMutationGeneration }
    inflightSearchRequests.set(cacheKey, entry)
    return promise
  },

  listProductiveTasks: async (filter = 'assigned', limit = 30, options, projectIds) => {
    const scope = getProductiveReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    // Why: project selection scopes the server-side filter, so it must be part of
    // the cache key or distinct selections would alias to one cached result.
    const projectKey = projectIds && projectIds.length > 0 ? projectIds.join(',') : ''
    const cacheKey = scopedProductiveCacheKey(scope, `list::${filter}::${limit}::${projectKey}`)
    const cached = get().productiveSearchCache[cacheKey]
    if (isFresh(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightListRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === productiveMutationGeneration
    ) {
      return inflight.promise
    }
    let entry: InflightProductiveReadRequest<ProductiveTask[]>
    const requestMutationGeneration = productiveMutationGeneration
    const promise = productiveListTasks(scope.settings, filter, limit, projectIds)
      .then((tasks) => {
        if (
          inflightListRequests.get(cacheKey) === entry &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            productiveSearchCache: evictStaleEntries({
              ...s.productiveSearchCache,
              [cacheKey]: { data: tasks, fetchedAt: Date.now() }
            })
          }))
        }
        return tasks
      })
      .catch((error) => {
        console.warn('[productive] listProductiveTasks failed:', error)
        if (
          looksLikeAuthError(error) &&
          !isIntegrationCredentialDecryptionError(error) &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set({ productiveStatus: { connected: false, viewer: null } })
        }
        if (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) {
          return []
        }
        throw error
      })
      .finally(() => {
        if (inflightListRequests.get(cacheKey) === entry) {
          inflightListRequests.delete(cacheKey)
        }
      })
    entry = { promise, contextKey, mutationGeneration: requestMutationGeneration }
    inflightListRequests.set(cacheKey, entry)
    return promise
  },

  listProductiveProjects: async (options) => {
    const scope = getProductiveReadScope(get().settings, options?.sourceContext)
    const { contextKey } = scope
    const cacheKey = scopedProductiveCacheKey(scope, 'projects')
    const cached = get().productiveProjectCache[cacheKey]
    if (isFresh(cached)) {
      return cached.data ?? []
    }
    const inflight = inflightProjectRequests.get(cacheKey)
    if (
      inflight &&
      inflight.contextKey === contextKey &&
      inflight.mutationGeneration === productiveMutationGeneration
    ) {
      return inflight.promise
    }
    let entry: InflightProductiveReadRequest<ProductiveProject[]>
    const requestMutationGeneration = productiveMutationGeneration
    const promise = productiveListProjects(scope.settings)
      .then((projects) => {
        if (
          inflightProjectRequests.get(cacheKey) === entry &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set((s) => ({
            productiveProjectCache: evictStaleEntries({
              ...s.productiveProjectCache,
              [cacheKey]: { data: projects, fetchedAt: Date.now() }
            })
          }))
        }
        return projects
      })
      .catch((error) => {
        console.warn('[productive] listProductiveProjects failed:', error)
        if (
          looksLikeAuthError(error) &&
          !isIntegrationCredentialDecryptionError(error) &&
          canWriteProductiveReadResult(
            contextKey,
            requestMutationGeneration,
            get().settings,
            scope.explicitSource
          )
        ) {
          set({ productiveStatus: { connected: false, viewer: null } })
        }
        if (isIntegrationCredentialDecryptionError(error) || looksLikeAuthError(error)) {
          return []
        }
        throw error
      })
      .finally(() => {
        if (inflightProjectRequests.get(cacheKey) === entry) {
          inflightProjectRequests.delete(cacheKey)
        }
      })
    entry = { promise, contextKey, mutationGeneration: requestMutationGeneration }
    inflightProjectRequests.set(cacheKey, entry)
    return promise
  },

  patchProductiveTask: (taskId, patch, options) => {
    const sourceScope =
      options?.sourceContext?.provider === 'productive'
        ? getTaskSourceCacheScope(options.sourceContext)
        : null
    const canPatchCacheKey = (key: string): boolean =>
      sourceScope === null || key.startsWith(`${sourceScope}::`)
    set((s) => {
      let changed = false
      const nextTaskCache = { ...s.productiveTaskCache }
      for (const [key, entry] of Object.entries(nextTaskCache)) {
        if (!canPatchCacheKey(key) || entry?.data?.id !== taskId) {
          continue
        }
        nextTaskCache[key] = { ...entry, data: { ...entry.data, ...patch }, fetchedAt: 0 }
        changed = true
      }
      const nextSearchCache = { ...s.productiveSearchCache }
      for (const key of Object.keys(nextSearchCache)) {
        const entry = nextSearchCache[key]
        if (!canPatchCacheKey(key) || !entry?.data) {
          continue
        }
        const index = entry.data.findIndex((task) => task.id === taskId)
        if (index === -1) {
          continue
        }
        const updatedItems = [...entry.data]
        updatedItems[index] = { ...updatedItems[index], ...patch }
        nextSearchCache[key] = { ...entry, data: updatedItems }
        changed = true
      }
      return changed
        ? { productiveTaskCache: nextTaskCache, productiveSearchCache: nextSearchCache }
        : {}
    })
  }
})
