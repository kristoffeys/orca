import React, { useCallback, useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { ProductiveProject } from '../../../../shared/productive-types'

type ProductiveProjectMultiComboboxProps = {
  projects: ProductiveProject[]
  /** Currently selected project ids. The component enforces `selected.size >= 1`
   *  by disabling the last-selected checkbox. */
  selected: ReadonlySet<string>
  /** Called with the next full selection set whenever the user changes it. */
  onChange: (next: ReadonlySet<string>) => void
  /** Clicking the sticky "All projects" row emits a full-set selection AND this
   *  signal, so the caller can persist sticky-all (every project) rather than a
   *  frozen snapshot that would exclude projects added later. */
  onSelectAll: () => void
  triggerClassName?: string
}

function projectMatchesQuery(project: ProductiveProject, query: string): boolean {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return true
  }
  const number = project.number != null ? `#${project.number}` : ''
  return project.name.toLowerCase().includes(trimmed) || number.toLowerCase().includes(trimmed)
}

function renderTriggerLabel(
  projects: ProductiveProject[],
  selected: ReadonlySet<string>
): React.JSX.Element {
  if (projects.length === 0) {
    return (
      <span className="text-muted-foreground">
        {translate('auto.components.ui.repo.multi.combobox.65a3dae41d', 'No projects')}
      </span>
    )
  }
  if (selected.size === projects.length) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {translate('auto.components.ui.repo.multi.combobox.bfd8ce21c6', 'All projects')}
      </span>
    )
  }
  const selectedProjects = projects.filter((p) => selected.has(p.id))
  const [first, second, ...rest] = selectedProjects
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
      {first ? <span className="truncate">{first.name}</span> : null}
      {second ? <span className="text-muted-foreground">, {second.name}</span> : null}
      {rest.length > 0 ? <span className="text-muted-foreground">+{rest.length}</span> : null}
    </span>
  )
}

export default function ProductiveProjectMultiCombobox({
  projects,
  selected,
  onChange,
  onSelectAll,
  triggerClassName
}: ProductiveProjectMultiComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [commandValue, setCommandValue] = useState('')

  const filteredProjects = useMemo(
    () => projects.filter((project) => projectMatchesQuery(project, query)),
    [projects, query]
  )
  const allSelected = selected.size === projects.length && projects.length > 0

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
    }
  }, [])

  const toggle = useCallback(
    (projectId: string) => {
      const next = new Set(selected)
      if (next.has(projectId)) {
        // Why: the empty selection is unreachable by design — the fetch effect
        // treats "all projects" as no project filter, so block the click instead
        // of silently allowing a no-op state.
        if (next.size <= 1) {
          return
        }
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      onChange(next)
    },
    [onChange, selected]
  )

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      // Why: toggle — clicking "All projects" while everything is selected
      // collapses to a single project, keeping the >= 1 invariant.
      const first = projects[0]
      if (!first) {
        return
      }
      onChange(new Set([first.id]))
      return
    }
    onSelectAll()
  }, [allSelected, onChange, onSelectAll, projects])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('h-8 w-full justify-between px-3 text-xs font-normal', triggerClassName)}
        >
          {renderTriggerLabel(projects, selected)}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Why: trigger width can be as narrow as the "All projects" label, but the
          popover hosts a search input and project rows. Use the trigger as a
          minimum width and let the content expand so names aren't truncated. */}
      <PopoverContent
        align="start"
        className="w-[min(320px,calc(100vw-1rem))] min-w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false} value={commandValue} onValueChange={setCommandValue}>
          <CommandInput
            autoFocus
            placeholder={translate(
              'auto.components.ui.repo.multi.combobox.a58a0cd100',
              'Search projects...'
            )}
            value={query}
            onValueChange={setQuery}
            className="text-xs"
          />
          {/* Why: sticky "All projects" row sits above the CommandList so it stays
              visible while scrolling a long list. Selecting it emits onSelectAll
              (not a snapshot via onChange) so the caller can persist sticky-all. */}
          <div className="border-b border-border">
            <button
              type="button"
              onClick={handleSelectAll}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setCommandValue('')}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                allSelected && 'opacity-80'
              )}
            >
              <Check
                className={cn(
                  'size-3 text-muted-foreground',
                  allSelected ? 'opacity-70' : 'opacity-0'
                )}
              />
              <span>
                {translate('auto.components.ui.repo.multi.combobox.bfd8ce21c6', 'All projects')}
              </span>
            </button>
          </div>
          <CommandList>
            <CommandEmpty>
              {translate(
                'auto.components.ui.repo.multi.combobox.4471d4a1c0',
                'No projects match your search.'
              )}
            </CommandEmpty>
            {filteredProjects.map((project) => {
              const isSelected = selected.has(project.id)
              const isLastSelected = isSelected && selected.size <= 1
              return (
                <CommandItem
                  key={project.id}
                  value={project.id}
                  onSelect={() => toggle(project.id)}
                  disabled={isLastSelected}
                  className="items-center gap-2 px-3 py-1.5 text-xs"
                >
                  <Check
                    className={cn(
                      'size-3 text-muted-foreground',
                      isSelected ? 'opacity-70' : 'opacity-0'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-foreground">{project.name}</span>
                    {project.number != null ? (
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        #{project.number}
                      </p>
                    ) : null}
                  </div>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
