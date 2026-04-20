/**
 * In-memory mock for better-sqlite3 database used in main process tests.
 */
import { vi } from 'vitest'

const store = new Map<string, string>()

const mockStatement = {
  run: vi.fn((...args: unknown[]) => {
    // For INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
    // We can capture this from the SQL string in prepare()
    return { changes: 1 }
  }),
  get: vi.fn((..._args: unknown[]): { value: string } | undefined => {
    return undefined
  }),
  all: vi.fn(() => [])
}

export function createMockDatabase() {
  store.clear()

  const preparedStatements = new Map<string, typeof mockStatement>()

  const db = {
    prepare: vi.fn((sql: string) => {
      const stmt = {
        run: vi.fn((...args: unknown[]) => {
          // Handle INSERT OR REPLACE INTO settings
          const insertMatch = sql.match(
            /INSERT OR REPLACE INTO settings \(key, value\) VALUES \((?:'([^']+)',\s*)?\?\)/
          )
          if (insertMatch) {
            const key = insertMatch[1] || (args[0] as string)
            const value = args[insertMatch[1] ? 0 : 1] as string
            store.set(key, value)
          }

          // Handle DELETE
          if (sql.startsWith('DELETE')) {
            const keys = sql.match(/key IN \(([^)]+)\)/)?.[1]
            if (keys) {
              keys
                .split(',')
                .map((k) => k.trim().replace(/'/g, ''))
                .forEach((k) => store.delete(k))
            }
          }

          return { changes: 1 }
        }),
        get: vi.fn((...args: unknown[]) => {
          // Handle SELECT value FROM settings WHERE key = ?
          const selectMatch = sql.match(/SELECT value FROM settings WHERE key = '([^']+)'/)
          if (selectMatch) {
            const key = selectMatch[1]
            const value = store.get(key)
            return value !== undefined ? { value } : undefined
          }
          // If key is a parameter
          if (sql.includes('WHERE key = ?') && args[0]) {
            const value = store.get(args[0] as string)
            return value !== undefined ? { value } : undefined
          }
          return undefined
        }),
        all: vi.fn(() => [])
      }
      preparedStatements.set(sql, stmt)
      return stmt
    }),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
    _store: store,
    _getStatement: (sql: string) => preparedStatements.get(sql)
  }

  return db
}

export function mockDatabaseModule() {
  const mockDb = createMockDatabase()

  vi.mock('../database', () => ({
    getDatabase: vi.fn(() => mockDb),
    closeDatabase: vi.fn()
  }))

  return mockDb
}

export { store as dbStore }
