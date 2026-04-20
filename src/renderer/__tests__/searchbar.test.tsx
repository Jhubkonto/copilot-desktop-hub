import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { SearchBar } from '../../renderer/components/SearchBar'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

import { afterEach } from 'vitest'

describe('SearchBar', () => {
  it('renders search input with placeholder', () => {
    render(<SearchBar onSearch={vi.fn()} />)
    expect(screen.getByPlaceholderText('Search conversations...')).toBeInTheDocument()
  })

  it('debounces search callback by 250ms', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)

    fireEvent.change(screen.getByPlaceholderText('Search conversations...'), {
      target: { value: 'hello' }
    })

    // Not called immediately
    expect(onSearch).not.toHaveBeenCalledWith('hello')

    // After 250ms
    act(() => { vi.advanceTimersByTime(250) })
    expect(onSearch).toHaveBeenCalledWith('hello')
  })

  it('shows clear button when query is non-empty', () => {
    render(<SearchBar onSearch={vi.fn()} />)

    expect(screen.queryByText('✕')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search conversations...'), {
      target: { value: 'test' }
    })

    expect(screen.getByText('✕')).toBeInTheDocument()
  })

  it('clear button resets the query', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)

    const input = screen.getByPlaceholderText('Search conversations...') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'query' } })

    fireEvent.click(screen.getByText('✕'))

    expect(input.value).toBe('')

    act(() => { vi.advanceTimersByTime(250) })
    expect(onSearch).toHaveBeenCalledWith('')
  })

  it('trims whitespace from search query', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)

    fireEvent.change(screen.getByPlaceholderText('Search conversations...'), {
      target: { value: '  hello  ' }
    })

    act(() => { vi.advanceTimersByTime(250) })
    expect(onSearch).toHaveBeenCalledWith('hello')
  })
})
