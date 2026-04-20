import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MarkdownRenderer } from '../../renderer/components/MarkdownRenderer'

// Mock clipboard API
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true
  })
})

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    render(<MarkdownRenderer content="Hello world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders bold and italic text', () => {
    render(<MarkdownRenderer content="**bold** and *italic*" />)
    expect(screen.getByText('bold')).toBeInTheDocument()
    expect(screen.getByText('italic')).toBeInTheDocument()
  })

  it('renders links with target=_blank', () => {
    render(<MarkdownRenderer content="[Click me](https://example.com)" />)
    const link = screen.getByText('Click me')
    expect(link.closest('a')).toHaveAttribute('target', '_blank')
    expect(link.closest('a')).toHaveAttribute('href', 'https://example.com')
  })

  it('renders code blocks with pre wrapper', () => {
    render(<MarkdownRenderer content={'```js\nconsole.log("hi")\n```'} />)
    const pre = document.querySelector('pre')
    expect(pre).toBeInTheDocument()
  })

  it('renders inline code', () => {
    render(<MarkdownRenderer content="Use `npm install` to install" />)
    const code = screen.getByText('npm install')
    expect(code.tagName).toBe('CODE')
  })

  it('renders tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |'
    render(<MarkdownRenderer content={md} />)
    expect(document.querySelector('table')).toBeInTheDocument()
  })

  it('renders lists', () => {
    const md = `- Item 1
- Item 2
- Item 3`
    const { container } = render(<MarkdownRenderer content={md} />)
    const listItems = container.querySelectorAll('li')
    expect(listItems.length).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('ul')).toBeInTheDocument()
  })

  it('has copy button on code blocks', () => {
    render(<MarkdownRenderer content={'```\nsome code\n```'} />)
    const copyBtn = screen.getByText('Copy')
    expect(copyBtn).toBeInTheDocument()
  })
})
