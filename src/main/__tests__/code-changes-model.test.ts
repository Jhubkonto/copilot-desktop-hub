import { describe, expect, it } from 'vitest'
import type { ErrorReportEntry } from '../../shared/types'
import {
  toCodeChangeRequest,
  toCodeChangesWorkspaceBinding,
} from '../../shared/code-changes'

const report = (overrides: Partial<ErrorReportEntry> = {}): ErrorReportEntry => ({
  id: 'request-1',
  title: 'Refactor parser',
  description: 'Keep behavior unchanged',
  screenshot_path: null,
  log_snapshot: null,
  status: 'open',
  app_version: null,
  platform: null,
  os_version: null,
  investigation_markdown: null,
  investigation_confidence: null,
  investigation_root_cause: null,
  investigation_affected_files: '[]',
  investigation_revision_notes: null,
  investigation_started_at: null,
  investigation_completed_at: null,
  fix_status: 'none',
  fix_staged_files: '[]',
  fix_started_at: null,
  fix_completed_at: null,
  fix_error: null,
  created_at: 100,
  updated_at: 200,
  ...overrides,
})

describe('code changes compatibility model', () => {
  it('adapts legacy report rows without losing the backing record', () => {
    const legacy = report()
    const request = toCodeChangeRequest(legacy, { workspaceRoot: 'C:\\repo' })

    expect(request).toMatchObject({
      id: 'request-1',
      requestType: 'edit',
      origin: 'legacy-bug-report',
      workspaceRoot: 'C:\\repo',
      createdAt: 100,
      updatedAt: 200,
      legacyReport: legacy,
    })
  })

  it('prefers persisted request metadata over compatibility defaults', () => {
    const request = toCodeChangeRequest(report({
      request_type: 'investigation',
      request_origin: 'android',
      workspace_root: '/repo',
      project_id: 'project-1',
    }))

    expect(request).toMatchObject({
      requestType: 'investigation',
      origin: 'android',
      workspaceRoot: '/repo',
      projectId: 'project-1',
    })
  })

  it('maps custom request type and its free-text label', () => {
    const request = toCodeChangeRequest(report({
      request_type: 'custom',
      custom_type_label: 'Data migration',
    }))

    expect(request).toMatchObject({
      requestType: 'custom',
      customTypeLabel: 'Data migration',
    })
  })

  it('represents disconnected and git-backed workspaces explicitly', () => {
    expect(toCodeChangesWorkspaceBinding(null).isConnected).toBe(false)
    expect(toCodeChangesWorkspaceBinding({
      rootDirectory: 'C:\\repo',
      exists: true,
      isLikelyCodingWorkspace: true,
      codingMarkers: ['package.json'],
      isGitRepo: true,
      repoRoot: 'C:\\repo',
      branch: 'main',
      dirty: true,
      scannedAt: 123,
    })).toMatchObject({
      isConnected: true,
      isGitRepo: true,
      branch: 'main',
      dirty: true,
    })
  })
})
