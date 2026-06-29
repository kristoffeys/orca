/* eslint-disable max-lines -- Why: Productive's JSON:API shape (side-loaded
   `included[]`, relationship resolution, category->bucket status mapping, and
   HTML<->Markdown body conversion) is one cohesive mapping boundary; keeping it
   together avoids drift between the task reads and the body-format helpers. */
import type {
  ProductiveComment,
  ProductivePerson,
  ProductiveProject,
  ProductiveRecord,
  ProductiveTask,
  ProductiveTaskList,
  ProductiveWorkflowStatus
} from '../../shared/productive-types'

// ---------------------------------------------------------------------------
// Defensive coercers (mirror Jira's asRecord/asString/asStringArray/asFiniteNumber)
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): ProductiveRecord {
  return value && typeof value === 'object' ? (value as ProductiveRecord) : {}
}

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value
  }
  // Why: Productive numeric ids (task_number, relationship ids) arrive as both
  // strings and numbers across endpoints; coerce so identifiers stay stable.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return fallback
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// ---------------------------------------------------------------------------
// JSON:API included[] resolution
// ---------------------------------------------------------------------------

export type IncludedLookup = Map<string, ProductiveRecord>

function includedKey(type: string, id: string): string {
  return `${type}:${id}`
}

/** Why: JSON:API side-loads related records in a flat `included[]` array keyed
 *  by {type,id}; relationships only carry the {type,id} pointer, so reads must
 *  resolve nested objects through this lookup rather than reading embedded data. */
export function buildIncludedLookup(included: unknown): IncludedLookup {
  const lookup: IncludedLookup = new Map()
  if (!Array.isArray(included)) {
    return lookup
  }
  for (const entry of included) {
    const record = asRecord(entry)
    const type = asString(record.type)
    const id = asString(record.id)
    if (type && id) {
      lookup.set(includedKey(type, id), record)
    }
  }
  return lookup
}

/** Resolve a single relationship pointer (`relationships.<name>.data`) to its
 *  side-loaded `included[]` record, returning {} when absent or unresolved. */
export function resolveRelationship(
  relationships: ProductiveRecord,
  name: string,
  lookup: IncludedLookup
): ProductiveRecord {
  const relationship = asRecord(asRecord(relationships)[name])
  const data = asRecord(relationship.data)
  const type = asString(data.type)
  const id = asString(data.id)
  if (!type || !id) {
    return {}
  }
  return lookup.get(includedKey(type, id)) ?? {}
}

/** The id a relationship points at, independent of whether it was side-loaded. */
export function relationshipId(relationships: ProductiveRecord, name: string): string | null {
  const data = asRecord(asRecord(asRecord(relationships)[name]).data)
  const id = asString(data.id)
  return id || null
}

// ---------------------------------------------------------------------------
// HTML <-> Markdown body helpers (replace Jira's ADF transform)
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' '
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    const named = HTML_ENTITIES[entity]
    if (named !== undefined) {
      return named
    }
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return match
  })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function looksLikeHtml(value: string): boolean {
  return /<[a-zA-Z/][^>]*>/.test(value)
}

/** Why: Productive description/comment bodies are HTML rich text, but the field
 *  has been observed to also carry plain text; accept both defensively and
 *  collapse toward Markdown so Orca renders them like Jira bodies. */
export function bodyToMarkdown(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  if (!looksLikeHtml(value)) {
    // Plain text — the transform is effectively identity (trimmed of trailing ws).
    return value
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  let text = value
  // Block-level breaks before stripping tags so structure survives.
  text = text.replace(/<\s*br\s*\/?\s*>/gi, '\n')
  text = text.replace(/<\s*\/\s*(p|div|h[1-6]|li|ul|ol|blockquote|pre|tr)\s*>/gi, '\n')
  text = text.replace(/<\s*li\b[^>]*>/gi, '- ')
  // Drop all remaining tags.
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Convert Orca's plain/Markdown editor text into the HTML body Productive
 *  expects. Paragraph-per-line with `<br>` joins inside; mirrors textToAdf's
 *  line-based structure but for HTML. */
export function markdownToBody(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n')
  const paragraphs = normalized.split(/\n{2,}/)
  return paragraphs
    .map((paragraph) => {
      const lines = paragraph.split('\n').map((line) => escapeHtml(line))
      return `<p>${lines.join('<br>')}</p>`
    })
    .join('')
}

// ---------------------------------------------------------------------------
// Status mapping (Productive workflow_status.category_id -> Orca buckets)
// ---------------------------------------------------------------------------

/** Why: Orca buckets statuses via Jira's categoryKey ('new'|'indeterminate'|
 *  'done'); Productive uses category_id 1/2/3, so map onto the same keys so the
 *  renderer's tone helpers work identically across providers. */
export function categoryKeyFromId(categoryId: unknown): string {
  // Why: Productive category_id 2 = Started, 3 = Closed; 1 (Not Started) and any
  // missing/unknown value fall back to the 'new' bucket so the renderer tone is
  // always defined. Plain branching avoids a switch over `number | null`.
  const id = asFiniteNumber(categoryId)
  if (id === 2) {
    return 'indeterminate'
  }
  if (id === 3) {
    return 'done'
  }
  return 'new'
}

function categoryNameFromKey(categoryKey: string): string {
  switch (categoryKey) {
    case 'new':
      return 'Not Started'
    case 'indeterminate':
      return 'Started'
    case 'done':
      return 'Closed'
    default:
      return 'Not Started'
  }
}

// ---------------------------------------------------------------------------
// Entity mappers
// ---------------------------------------------------------------------------

function personName(attributes: ProductiveRecord): string {
  const first = asString(attributes.first_name)
  const last = asString(attributes.last_name)
  const joined = [first, last].filter(Boolean).join(' ').trim()
  return joined || asString(attributes.name) || asString(attributes.email, 'Unknown')
}

export function mapPerson(record: unknown): ProductivePerson | undefined {
  const data = asRecord(record)
  const id = asString(data.id)
  if (!id) {
    return undefined
  }
  const attributes = asRecord(data.attributes)
  return {
    id,
    name: personName(attributes),
    email: asString(attributes.email) || undefined,
    avatarUrl: asString(attributes.avatar_url) || undefined
  }
}

export function mapProject(record: unknown): ProductiveProject {
  const data = asRecord(record)
  const attributes = asRecord(data.attributes)
  return {
    id: asString(data.id),
    name: asString(attributes.name, 'Untitled project'),
    // Why: Productive exposes a per-org sequential project_number; surface it as
    // the human-facing key analog when present.
    number: asFiniteNumber(attributes.project_number) ?? undefined
  }
}

export function mapTaskList(record: unknown): ProductiveTaskList {
  const data = asRecord(record)
  const attributes = asRecord(data.attributes)
  const relationships = asRecord(data.relationships)
  return {
    id: asString(data.id),
    name: asString(attributes.name, 'Untitled list'),
    projectId: relationshipId(relationships, 'project') ?? undefined
  }
}

export function mapWorkflowStatus(record: unknown): ProductiveWorkflowStatus {
  const data = asRecord(record)
  const attributes = asRecord(data.attributes)
  const categoryKey = categoryKeyFromId(attributes.category_id)
  return {
    id: asString(data.id),
    name: asString(attributes.name, 'Unknown'),
    categoryId: asFiniteNumber(attributes.category_id) ?? 1,
    categoryKey,
    categoryName: categoryNameFromKey(categoryKey),
    color: asString(attributes.color) || undefined
  }
}

export function mapComment(record: unknown, lookup?: IncludedLookup): ProductiveComment {
  const data = asRecord(record)
  const attributes = asRecord(data.attributes)
  const relationships = asRecord(data.relationships)
  const author = lookup
    ? resolveRelationship(relationships, 'creator', lookup)
    : asRecord(attributes.creator)
  return {
    id: asString(data.id),
    body: bodyToMarkdown(attributes.body ?? attributes.commentable_body),
    createdAt: asString(attributes.created_at, new Date().toISOString()),
    updatedAt: asString(attributes.updated_at) || undefined,
    user: mapPerson(author)
  }
}

/** Resolve the workflow status whether it is side-loaded under `workflow_status`
 *  or only described by attributes (status_id + category fields). */
function resolveTaskStatus(
  attributes: ProductiveRecord,
  relationships: ProductiveRecord,
  lookup: IncludedLookup
): ProductiveWorkflowStatus {
  const sideLoaded = resolveRelationship(relationships, 'workflow_status', lookup)
  if (asString(sideLoaded.id)) {
    return mapWorkflowStatus(sideLoaded)
  }
  // Fallback: synthesize from the relationship id + any attribute category hint.
  const id = relationshipId(relationships, 'workflow_status') ?? asString(attributes.status_id)
  const categoryKey = categoryKeyFromId(attributes.status_category_id ?? attributes.category_id)
  return {
    id,
    name: asString(attributes.status_name, 'Unknown'),
    categoryId: asFiniteNumber(attributes.status_category_id ?? attributes.category_id) ?? 1,
    categoryKey,
    categoryName: categoryNameFromKey(categoryKey),
    color: undefined
  }
}

export function taskUrl(organizationId: string, task: { id: string; projectId?: string }): string {
  // Why: the org-scoped prefix is the load-bearing part; Productive resolves the
  // short /task/<id> deep link to the full project-scoped path.
  return `https://app.productive.io/${encodeURIComponent(organizationId)}/task/${encodeURIComponent(
    task.id
  )}`
}

export function mapProductiveTask(
  organizationId: string,
  raw: unknown,
  included?: unknown
): ProductiveTask {
  const data = asRecord(raw)
  const attributes = asRecord(data.attributes)
  const relationships = asRecord(data.relationships)
  const lookup = buildIncludedLookup(included)

  const id = asString(data.id)
  const taskNumber = asFiniteNumber(attributes.task_number)
  const project = mapProject(resolveRelationship(relationships, 'project', lookup))
  const projectId = relationshipId(relationships, 'project') ?? (project.id || undefined)
  const assigneeRecord = resolveRelationship(relationships, 'assignee', lookup)
  const status = resolveTaskStatus(attributes, relationships, lookup)
  const now = new Date().toISOString()

  return {
    id,
    number: asFiniteNumber(id) ?? 0,
    taskNumber: taskNumber ?? undefined,
    productiveIdentifier: `#${taskNumber ?? id}`,
    title: asString(attributes.title, id ? `#${taskNumber ?? id}` : 'Untitled task'),
    description: bodyToMarkdown(attributes.description),
    url: taskUrl(organizationId, { id, projectId }),
    organizationId,
    project: projectId ? { ...project, id: projectId } : project,
    taskListId: relationshipId(relationships, 'task_list') ?? undefined,
    status,
    assignee: mapPerson(assigneeRecord),
    createdAt: asString(attributes.created_at, now),
    updatedAt: asString(attributes.updated_at ?? attributes.last_activity_at, now)
  }
}
