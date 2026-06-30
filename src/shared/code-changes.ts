import type {
  CodeChangeRequest,
  CodeChangeRequestOrigin,
  CodeChangeRequestPhase,
  CodeChangesWorkspaceBinding,
  ErrorReportEntry,
  ProjectWorkspaceMetadata,
  RemoteEditVerificationRun,
} from './types'

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

export function deriveCodeChangePhase(
  report: ErrorReportEntry,
  verificationRun: RemoteEditVerificationRun | null,
  committed: boolean,
): CodeChangeRequestPhase {
  if (committed) return 'committed'
  if (verificationRun?.status === 'success') return 'ready-to-commit'
  if (verificationRun?.status === 'failed' || report.fix_status === 'failed' || report.status === 'rejected') {
    return 'needs-attention'
  }
  if (verificationRun?.status === 'running') return 'verifying'
  if (report.fix_status === 'applied') return 'applied'
  if (report.fix_status === 'applying') return 'ready-to-apply'
  if (report.fix_status === 'staged') return 'patch-ready'
  if (report.fix_status === 'staging' || report.status === 'investigated') return 'patch-ready'
  if (report.status === 'investigating' || report.investigation_markdown) return 'investigating'
  return 'draft'
}

export const CODE_CHANGE_PHASE_LABELS: Record<CodeChangeRequestPhase, string> = {
  draft: 'Draft',
  investigating: 'Investigating',
  'patch-ready': 'Patch ready',
  'ready-to-apply': 'Ready to apply',
  applied: 'Applied',
  verifying: 'Verifying',
  'ready-to-commit': 'Ready to commit',
  committed: 'Committed',
  'needs-attention': 'Needs attention',
}

export const CODE_CHANGE_PHASE_GUIDANCE: Record<CodeChangeRequestPhase, string> = {
  draft: 'Run an investigation to identify the files and approach.',
  investigating: 'Review the investigation before generating a patch.',
  'patch-ready': 'Review every staged file before applying changes.',
  'ready-to-apply': 'Apply the reviewed patch to the connected workspace.',
  applied: 'Run verification against the changed workspace.',
  verifying: 'Verification is running against the connected workspace.',
  'ready-to-commit': 'Review the repository state and create a commit.',
  committed: 'The change has been committed and can be pushed when needed.',
  'needs-attention': 'Review the failure details, revise the request, and retry.',
}
