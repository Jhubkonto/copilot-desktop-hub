/**
 * Vitest setup file for the "main" test project.
 * Initialises sql.js (pure-WASM SQLite) and injects it into the
 * better-sqlite3 shim so that database.test.ts can run without the
 * native better-sqlite3 binary (which is compiled for Electron's ABI).
 */
import initSqlJs from 'sql.js'
import { setSqlInstance } from './mocks/better-sqlite3-shim'

const SQL = await initSqlJs()
setSqlInstance(SQL)
