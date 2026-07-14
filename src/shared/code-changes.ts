import type {
  CodeChangeRequest,
  CodeChangeRequestOrigin,
  CodeChangeRequestType,
  CodeChangesWorkspaceBinding,
  ErrorReportEntry,
  ProjectWorkspaceMetadata,
  RemoteEditVerifyCommandConfig,
} from './types'

// The verification commands used when a project has no ProjectConfig.verifyCommands override —
// reproduces the behavior this list used to be hardcoded to in remote-edit/verifier.ts.
export const DEFAULT_VERIFY_COMMANDS: RemoteEditVerifyCommandConfig[] = [
  { id: 'typecheck', label: 'Typecheck', command: 'npm run typecheck' },
  { id: 'lint', label: 'Lint', command: 'npm run lint' },
  { id: 'test', label: 'Test', command: 'npm run test' },
  { id: 'build', label: 'Build', command: 'npm run build' },
]

export function toCodeChangeRequest(
  report: ErrorReportEntry,
  context: {
    origin?: CodeChangeRequestOrigin
    projectId?: string | null
    workspaceRoot?: string | null
  } = {},
): CodeChangeRequest {
  return {
    id: report.id,
    title: report.title,
    description: report.description,
    requestType: report.request_type ?? (context.origin === 'build-failure' ? 'bugfix' : 'edit'),
    customTypeLabel: report.custom_type_label ?? null,
    workspaceRoot: report.workspace_root ?? context.workspaceRoot ?? null,
    projectId: report.project_id ?? context.projectId ?? null,
    origin: report.request_origin ?? context.origin ?? 'legacy-bug-report',
    status: report.status,
    createdAt: report.created_at,
    updatedAt: report.updated_at,
    legacyReport: report,
  }
}

export function toCodeChangesWorkspaceBinding(
  workspace: ProjectWorkspaceMetadata | null | undefined,
): CodeChangesWorkspaceBinding {
  return {
    rootDirectory: workspace?.rootDirectory ?? '',
    isGitRepo: workspace?.isGitRepo ?? false,
    repoRoot: workspace?.repoRoot ?? null,
    branch: workspace?.branch ?? null,
    dirty: workspace?.dirty ?? false,
    isConnected: Boolean(workspace?.exists && workspace.rootDirectory),
    lastValidatedAt: workspace?.scannedAt ?? null,
  }
}

export const CODE_CHANGE_REQUEST_TYPE_LABELS: Record<CodeChangeRequestType, string> = {
  edit: 'Edit',
  refactor: 'Refactor',
  bugfix: 'Bug fix',
  feature: 'Feature',
  investigation: 'Investigation',
  custom: 'Custom',
}

export function codeChangeRequestTypeLabel(
  requestType: CodeChangeRequestType,
  customTypeLabel: string | null,
): string {
  if (requestType === 'custom' && customTypeLabel) return customTypeLabel
  return CODE_CHANGE_REQUEST_TYPE_LABELS[requestType]
}

export function hasWorkspaceMismatch(
  requestWorkspaceRoot: string | null,
  currentWorkspaceRoot: string | null,
): boolean {
  if (!requestWorkspaceRoot || !currentWorkspaceRoot) return false
  return requestWorkspaceRoot !== currentWorkspaceRoot
}
