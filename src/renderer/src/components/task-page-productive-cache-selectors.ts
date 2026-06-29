import type { CacheEntry } from '@/store/slices/github'
import {
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import type { ProductiveTask } from '../../../shared/productive-types'

type ProductiveTaskCache = Record<string, CacheEntry<ProductiveTask>>
type ProductiveSearchCache = Record<string, CacheEntry<ProductiveTask[]>>

export type TaskPageProductiveTaskLookupOptions = {
  sourceContext?: TaskSourceContext | null
}

export function findTaskPageProductiveTask(
  productiveTaskCache: ProductiveTaskCache,
  productiveSearchCache: ProductiveSearchCache,
  productiveTaskId: string | null,
  options: TaskPageProductiveTaskLookupOptions = {}
): ProductiveTask | null {
  if (!productiveTaskId) {
    return null
  }
  const sourceScope =
    options.sourceContext?.provider === 'productive'
      ? getTaskSourceCacheScope(options.sourceContext)
      : null
  const matchesLookup = (cacheKey: string, task: ProductiveTask | null | undefined): boolean => {
    if (!task || task.id !== productiveTaskId) {
      return false
    }
    // Why: Productive task ids are unique per organization, but the drawer
    // lookup still scopes by source so it never borrows a task cached for
    // another runtime/account context.
    return sourceScope === null || cacheKey.startsWith(`${sourceScope}::`)
  }

  for (const [cacheKey, entry] of Object.entries(productiveTaskCache)) {
    if (matchesLookup(cacheKey, entry?.data)) {
      return entry.data
    }
  }

  for (const [cacheKey, entry] of Object.entries(productiveSearchCache)) {
    const found = entry?.data?.find((task) => matchesLookup(cacheKey, task))
    if (found) {
      return found
    }
  }

  return null
}
