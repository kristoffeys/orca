import { describe, expect, it } from 'vitest'
import { bodyToMarkdown } from './mapper'

describe('bodyToMarkdown mention rendering', () => {
  it('renders a Productive @-mention token as a readable @Label', () => {
    const raw =
      'cc @[{"type":"person","id":"1072309","label":"Alexander Verbeke","avatar_url":null,"attachment_url":null,"is_done":false}] please review'
    expect(bodyToMarkdown(raw)).toBe('cc @Alexander Verbeke please review')
  })

  it('renders multiple mentions in one body', () => {
    const raw =
      '@[{"type":"person","id":"1","label":"Ada Lovelace"}] and @[{"type":"person","id":"2","label":"Alan Turing"}]'
    expect(bodyToMarkdown(raw)).toBe('@Ada Lovelace and @Alan Turing')
  })

  it('renders mentions inside HTML bodies after tag stripping', () => {
    const raw = '<p>Ping @[{"type":"person","id":"9","label":"Grace Hopper"}]</p>'
    expect(bodyToMarkdown(raw)).toBe('Ping @Grace Hopper')
  })

  it('leaves non-mention bracket text untouched', () => {
    expect(bodyToMarkdown('see list [1, 2, 3] here')).toBe('see list [1, 2, 3] here')
  })
})
