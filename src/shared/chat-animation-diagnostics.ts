export interface ChatAnimationDiagnosticSnapshot {
  backlogLength: number
  revealLagMs: number
  droppedDuplicateEvents: number
  sequenceGaps: number
  snapshotRecoveries: number
}

export class ChatAnimationDiagnostics {
  private snapshot: ChatAnimationDiagnosticSnapshot = {
    backlogLength: 0,
    revealLagMs: 0,
    droppedDuplicateEvents: 0,
    sequenceGaps: 0,
    snapshotRecoveries: 0,
  }

  recordBacklog(length: number, oldestPendingAt?: number, now = Date.now()): void {
    this.snapshot.backlogLength = Math.max(0, length)
    this.snapshot.revealLagMs = length > 0 && oldestPendingAt ? Math.max(0, now - oldestPendingAt) : 0
  }

  recordSequence(lastSequence: number, sequence: number): void {
    if (sequence <= lastSequence) this.snapshot.droppedDuplicateEvents++
    else if (lastSequence > 0 && sequence > lastSequence + 1) this.snapshot.sequenceGaps++
  }

  recordSnapshotRecovery(): void {
    this.snapshot.snapshotRecoveries++
  }

  read(): ChatAnimationDiagnosticSnapshot {
    return { ...this.snapshot }
  }

  reset(): void {
    this.snapshot = {
      backlogLength: 0,
      revealLagMs: 0,
      droppedDuplicateEvents: 0,
      sequenceGaps: 0,
      snapshotRecoveries: 0,
    }
  }
}
