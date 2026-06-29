/* eslint-disable max-lines -- Why: the Productive drawer co-locates preview,
   metadata edits, and comments so the task page has one full task surface,
   mirroring JiraIssueWorkspace. */
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: Productive task hydration, comments, workflow statuses, and assignable people are loaded from provider IPC for the selected task. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Clipboard,
  ExternalLink,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Save,
  Send,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { VisuallyHidden } from 'radix-ui'

import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { ProductiveIcon } from '@/components/icons/ProductiveIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { useAppStore } from '@/store'
import {
  productiveAddTaskComment,
  productiveGetTask,
  productiveListAssignablePeople,
  productiveListWorkflowStatuses,
  productiveTaskComments,
  productiveUpdateTask
} from '@/runtime/runtime-productive-client'
import type {
  ProductiveComment,
  ProductivePerson,
  ProductiveTask,
  ProductiveWorkflowStatus
} from '../../../shared/productive-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { translate } from '@/i18n/i18n'

type ProductiveTaskWorkspaceProps = {
  task: ProductiveTask | null
  onUse: (task: ProductiveTask) => void
  onClose: () => void
  sourceContext?: TaskSourceContext | null
}

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function formatRelativeTime(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return 'recently'
  }
  const diffMinutes = Math.round((date.getTime() - Date.now()) / 60_000)
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, 'hour')
  }
  return relativeFormatter.format(Math.round(diffHours / 24), 'day')
}

function buildProductiveBranchName(task: ProductiveTask): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52)
  // Why: Productive identifiers are like "#1", so strip non-alphanumerics to
  // keep the branch prefix git-safe before joining the title slug.
  const idSlug = task.productiveIdentifier.toLowerCase().replace(/[^a-z0-9]+/g, '')
  return `${idSlug || 'task'}${slug ? `-${slug}` : ''}`
}

function buildProductivePrompt(task: ProductiveTask): string {
  return `Complete Productive task ${task.productiveIdentifier}: ${task.title}\n\n${task.url}`
}

// Why: Productive workflow categories are mapped onto the same
// 'new'|'indeterminate'|'done' keys Jira uses (mapper.ts), so the pill tones
// match the Jira drawer for visual parity.
function productiveStatusClass(categoryKey: string): string {
  if (categoryKey === 'done') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (categoryKey === 'indeterminate') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
  }
  return 'border-border/50 bg-muted/40 text-muted-foreground'
}

async function copyTextToClipboard(text: string, label: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(text)
    toast.success(
      translate('auto.components.ProductiveTaskWorkspace.copysuccess', '{{value0}} copied', {
        value0: label
      })
    )
  } catch {
    toast.error(
      translate('auto.components.ProductiveTaskWorkspace.copyfail', 'Failed to copy {{value0}}', {
        value0: label.toLowerCase()
      })
    )
  }
}

export default function ProductiveTaskWorkspace({
  task,
  onUse,
  onClose,
  sourceContext
}: ProductiveTaskWorkspaceProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const providerSettings = sourceContext ?? settings
  const patchProductiveTask = useAppStore((s) => s.patchProductiveTask)
  const [fullTask, setFullTask] = useState<ProductiveTask | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [comments, setComments] = useState<ProductiveComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [statuses, setStatuses] = useState<ProductiveWorkflowStatus[]>([])
  const [people, setPeople] = useState<ProductivePerson[]>([])
  const [pendingField, setPendingField] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const requestIdRef = useRef(0)
  const optimisticCommentsRef = useRef<ProductiveComment[]>([])

  const displayed = fullTask ?? task

  const loadComments = useCallback(
    async (targetTask: ProductiveTask, requestId: number): Promise<void> => {
      setCommentsLoading(true)
      setCommentsError(null)
      try {
        let fetched = await productiveTaskComments(providerSettings, targetTask.id)
        if (requestId !== requestIdRef.current) {
          return
        }
        const optimistic = optimisticCommentsRef.current
        if (optimistic.length > 0) {
          const fetchedIds = new Set(fetched.map((comment) => comment.id))
          fetched = [...fetched, ...optimistic.filter((comment) => !fetchedIds.has(comment.id))]
        }
        setComments(fetched)
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setCommentsError(error instanceof Error ? error.message : 'Failed to load comments.')
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setCommentsLoading(false)
        }
      }
    },
    [providerSettings]
  )

  useEffect(() => {
    if (!task) {
      setFullTask(null)
      setTaskLoading(false)
      setComments([])
      setCommentsError(null)
      setStatuses([])
      setPeople([])
      setCommentDraft('')
      optimisticCommentsRef.current = []
      return
    }

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    optimisticCommentsRef.current = []
    setFullTask(task)
    setTitleDraft(task.title)
    setComments([])
    setCommentsError(null)
    setTaskLoading(true)

    void productiveGetTask(providerSettings, task.id)
      .then((result) => {
        if (requestId !== requestIdRef.current) {
          return
        }
        if (result) {
          setFullTask(result)
          setTitleDraft(result.title)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setTaskLoading(false)
        }
      })

    void Promise.all([
      productiveListWorkflowStatuses(providerSettings),
      productiveListAssignablePeople(providerSettings, task.id)
    ])
      .then(([nextStatuses, nextPeople]) => {
        if (requestId !== requestIdRef.current) {
          return
        }
        setStatuses(nextStatuses)
        setPeople(nextPeople)
      })
      .catch(() => {})

    void loadComments(task, requestId)
  }, [task, loadComments, providerSettings])

  const refreshTask = useCallback(async (): Promise<void> => {
    if (!displayed) {
      return
    }
    try {
      const latest = await productiveGetTask(providerSettings, displayed.id)
      if (latest) {
        setFullTask(latest)
        patchProductiveTask(latest.id, latest, { sourceContext })
      }
    } catch {
      // Keep the visible task snapshot if refresh fails.
    }
  }, [displayed, patchProductiveTask, providerSettings, sourceContext])

  const mutateTask = useCallback(
    async (
      field: string,
      updates: Parameters<typeof productiveUpdateTask>[2],
      optimistic?: Partial<ProductiveTask>
    ): Promise<void> => {
      if (!displayed || pendingField) {
        return
      }
      setPendingField(field)
      const previous = displayed
      try {
        if (optimistic) {
          setFullTask({ ...displayed, ...optimistic })
          patchProductiveTask(displayed.id, optimistic, { sourceContext })
        }
        const result = await productiveUpdateTask(providerSettings, displayed.id, updates)
        if (!result.ok) {
          throw new Error(result.error)
        }
        await refreshTask()
      } catch (error) {
        setFullTask(previous)
        patchProductiveTask(previous.id, previous, { sourceContext })
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.ProductiveTaskWorkspace.updatefail',
                'Failed to update Productive task.'
              )
        )
      } finally {
        setPendingField(null)
      }
    },
    [displayed, patchProductiveTask, pendingField, refreshTask, providerSettings, sourceContext]
  )

  const handleSaveTitle = useCallback(() => {
    if (!displayed) {
      return
    }
    const title = titleDraft.trim()
    if (!title || title === displayed.title) {
      setTitleDraft(displayed.title)
      return
    }
    void mutateTask('title', { title }, { title })
  }, [displayed, mutateTask, titleDraft])

  const handleSubmitComment = useCallback(async (): Promise<void> => {
    if (!displayed || commentSubmitting) {
      return
    }
    const bodyState = getCommentBodySubmitState(commentDraft)
    if (bodyState.status === 'empty') {
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.ProductiveTaskWorkspace.commentTooLarge',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    setCommentSubmitting(true)
    try {
      const result = await productiveAddTaskComment(providerSettings, displayed.id, bodyState.body)
      if (!result.ok) {
        throw new Error(result.error)
      }
      const comment: ProductiveComment = {
        id: result.id || createBrowserUuid(),
        body: bodyState.body,
        createdAt: new Date().toISOString(),
        user: { id: 'local', name: 'You' }
      }
      optimisticCommentsRef.current.push(comment)
      setComments((prev) => [...prev, comment])
      setCommentDraft('')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.ProductiveTaskWorkspace.commentfail',
              'Failed to add comment.'
            )
      )
    } finally {
      setCommentSubmitting(false)
    }
  }, [commentDraft, commentSubmitting, displayed, providerSettings])
  const canSubmitComment = hasBoundedCommentBodyText(commentDraft)

  const actionItems = useMemo(() => {
    if (!displayed) {
      return []
    }
    return [
      {
        label: translate('auto.components.ProductiveTaskWorkspace.openin', 'Open in Productive'),
        icon: ExternalLink,
        action: () => window.api.shell.openUrl(displayed.url)
      },
      {
        label: translate('auto.components.ProductiveTaskWorkspace.copyurl', 'Copy URL'),
        icon: Clipboard,
        action: () => void copyTextToClipboard(displayed.url, 'URL')
      },
      {
        label: translate('auto.components.ProductiveTaskWorkspace.copyid', 'Copy ID'),
        icon: Clipboard,
        action: () => void copyTextToClipboard(displayed.productiveIdentifier, 'ID')
      },
      {
        label: translate(
          'auto.components.ProductiveTaskWorkspace.copybranch',
          'Copy suggested branch name'
        ),
        icon: GitBranch,
        action: () => void copyTextToClipboard(buildProductiveBranchName(displayed), 'Branch name')
      },
      {
        label: translate('auto.components.ProductiveTaskWorkspace.copyprompt', 'Copy prompt'),
        icon: Clipboard,
        action: () => void copyTextToClipboard(buildProductivePrompt(displayed), 'Prompt')
      }
    ]
  }, [displayed])

  return (
    <Sheet open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,780px)] p-0 sm:max-w-[780px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <VisuallyHidden.Root asChild>
          <SheetTitle>
            {displayed?.title ??
              translate('auto.components.ProductiveTaskWorkspace.tasktitle', 'Productive task')}
          </SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>
            {translate(
              'auto.components.ProductiveTaskWorkspace.taskdescription',
              'Preview, edit, and start work from the selected task.'
            )}
          </SheetDescription>
        </VisuallyHidden.Root>

        {displayed ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
            <div className="flex-none border-b border-border/50 bg-muted/30 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{displayed.productiveIdentifier}</span>
                    <span>{displayed.project.name}</span>
                    <span>{formatRelativeTime(displayed.updatedAt)}</span>
                    {taskLoading ? <LoaderCircle className="size-3 animate-spin" /> : null}
                  </div>
                  <h2 className="mt-1 text-[20px] font-semibold leading-tight text-foreground">
                    {displayed.title}
                  </h2>
                </div>
                <Button
                  onClick={() => onUse(displayed)}
                  className="hidden shrink-0 gap-2 sm:inline-flex"
                  size="sm"
                >
                  {translate(
                    'auto.components.ProductiveTaskWorkspace.startworkspace',
                    'Start workspace'
                  )}
                  <ArrowRight className="size-4" />
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0"
                      onClick={onClose}
                      aria-label={translate(
                        'auto.components.ProductiveTaskWorkspace.closepreview',
                        'Close Productive task preview'
                      )}
                    >
                      <X className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6}>
                    {translate('auto.components.ProductiveTaskWorkspace.close', 'Close')}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={pendingField === 'status' || statuses.length === 0}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:opacity-80 disabled:opacity-50',
                      productiveStatusClass(displayed.status.categoryKey)
                    )}
                  >
                    {displayed.status.name}
                    {pendingField === 'status' ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="popover-scroll-content scrollbar-sleek w-52 p-1"
                  align="start"
                >
                  {statuses.map((status) => (
                    <button
                      key={status.id}
                      type="button"
                      onClick={() =>
                        void mutateTask('status', { workflowStatusId: status.id }, { status })
                      }
                      className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent"
                    >
                      {status.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={pendingField === 'assignee'}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/40 disabled:opacity-50"
                  >
                    {displayed.assignee?.name ??
                      translate(
                        'auto.components.ProductiveTaskWorkspace.addassignee',
                        '+ Assignee'
                      )}
                    {pendingField === 'assignee' ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="popover-scroll-content scrollbar-sleek w-56 p-1"
                  align="start"
                >
                  <button
                    type="button"
                    onClick={() =>
                      void mutateTask('assignee', { assigneeId: null }, { assignee: undefined })
                    }
                    className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent"
                  >
                    {translate('auto.components.ProductiveTaskWorkspace.unassigned', 'Unassigned')}
                  </button>
                  {people.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() =>
                        void mutateTask('assignee', { assigneeId: person.id }, { assignee: person })
                      }
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent"
                    >
                      {person.avatarUrl ? (
                        <img src={person.avatarUrl} alt="" className="size-5 rounded-full" />
                      ) : null}
                      <span className="truncate">{person.name}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_228px]">
              <div className="min-h-0 overflow-y-auto scrollbar-sleek">
                <section className="border-b border-border/40 px-4 py-4">
                  <div className="grid gap-2">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {translate('auto.components.ProductiveTaskWorkspace.title', 'Title')}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            handleSaveTitle()
                          }
                        }}
                        className="h-8 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleSaveTitle}
                        disabled={pendingField === 'title'}
                      >
                        {pendingField === 'title' ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Save className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </section>

                <section className="border-b border-border/40 px-4 py-4">
                  <div className="mb-2 flex items-center gap-2">
                    <ProductiveIcon className="size-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground">
                      {displayed.project.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {displayed.assignee?.name ??
                        translate(
                          'auto.components.ProductiveTaskWorkspace.unassigned',
                          'Unassigned'
                        )}
                    </span>
                  </div>
                  {displayed.description?.trim() ? (
                    <CommentMarkdown
                      content={displayed.description}
                      variant="document"
                      className="text-[14px] leading-relaxed"
                    />
                  ) : (
                    <p className="text-sm italic text-muted-foreground">
                      {translate(
                        'auto.components.ProductiveTaskWorkspace.nodescription',
                        'No description provided.'
                      )}
                    </p>
                  )}
                </section>

                <section className="px-4 py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">
                        {translate('auto.components.ProductiveTaskWorkspace.comments', 'Comments')}
                      </span>
                      {comments.length > 0 ? (
                        <span className="text-[12px] text-muted-foreground">{comments.length}</span>
                      ) : null}
                    </div>
                    {commentsError ? (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => void loadComments(displayed, requestIdRef.current)}
                        disabled={commentsLoading}
                        className="gap-1"
                      >
                        {commentsLoading ? (
                          <LoaderCircle className="size-3 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3" />
                        )}
                        {translate('auto.components.ProductiveTaskWorkspace.retry', 'Retry')}
                      </Button>
                    ) : null}
                  </div>
                  {commentsError ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {commentsError}
                    </div>
                  ) : commentsLoading && comments.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {translate(
                        'auto.components.ProductiveTaskWorkspace.nocomments',
                        'No comments yet.'
                      )}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {comments.map((comment) => (
                        <div
                          key={comment.id}
                          className="rounded-md border border-border/50 bg-muted/20"
                        >
                          <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2">
                            {comment.user?.avatarUrl ? (
                              <img
                                src={comment.user.avatarUrl}
                                alt=""
                                className="size-5 shrink-0 rounded-full"
                              />
                            ) : null}
                            <span className="truncate text-[13px] font-semibold text-foreground">
                              {comment.user?.name ??
                                translate(
                                  'auto.components.ProductiveTaskWorkspace.unknown',
                                  'Unknown'
                                )}
                            </span>
                            <span className="shrink-0 text-[12px] text-muted-foreground">
                              {formatRelativeTime(comment.createdAt)}
                            </span>
                          </div>
                          <div className="px-3 py-2">
                            <CommentMarkdown
                              content={comment.body}
                              className="text-[13px] leading-relaxed"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <aside className="border-t border-border/50 bg-muted/20 px-3 py-3 xl:border-l xl:border-t-0">
                <Button
                  onClick={() => onUse(displayed)}
                  className="mb-3 w-full justify-center gap-2 sm:hidden"
                >
                  {translate(
                    'auto.components.ProductiveTaskWorkspace.startworkspace',
                    'Start workspace'
                  )}
                  <ArrowRight className="size-4" />
                </Button>
                <div className="grid gap-1">
                  {actionItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <Tooltip key={item.label}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={item.action}
                            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                          >
                            <Icon className="size-3.5 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" sideOffset={6}>
                          {item.label}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              </aside>
            </div>

            <div className="flex-none border-t border-border/50 bg-background px-3 py-3">
              <div className="flex gap-2">
                <textarea
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  placeholder={translate(
                    'auto.components.ProductiveTaskWorkspace.commentplaceholder',
                    'Add a Productive comment...'
                  )}
                  rows={2}
                  disabled={commentSubmitting}
                  className="min-h-10 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <Button
                  onClick={() => void handleSubmitComment()}
                  disabled={!canSubmitComment || commentSubmitting}
                  className="self-end gap-2"
                >
                  {commentSubmitting ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {translate('auto.components.ProductiveTaskWorkspace.comment', 'Comment')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
