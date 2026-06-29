import type { ProductiveProject, ProductiveTask } from '../../../../shared/productive-types'

export type ProductiveTaskProjectGroup = {
  project: ProductiveProject
  tasks: ProductiveTask[]
}

// Why: Productive tasks already carry a full `project` object, so grouping is a
// pure client-side reduce keyed by project id — no extra fetch is needed. Groups
// are sorted by project name for a stable, scannable order.
export function getProductiveTaskProjectGroups(
  tasks: ProductiveTask[]
): ProductiveTaskProjectGroup[] {
  const groups = new Map<string, ProductiveTaskProjectGroup>()
  for (const task of tasks) {
    const existing = groups.get(task.project.id)
    if (existing) {
      existing.tasks.push(task)
    } else {
      groups.set(task.project.id, { project: task.project, tasks: [task] })
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.project.name.localeCompare(b.project.name))
}
