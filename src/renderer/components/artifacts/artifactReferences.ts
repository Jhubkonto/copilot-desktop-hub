const ARTIFACT_REF_PREFIX = '__artifact-ref:'

export interface ArtifactReference {
  artifactId: string
  versionId?: string
  kind?: string
  pending?: boolean
}

export function parseArtifactReference(content: string): ArtifactReference | null {
  if (!content.startsWith(ARTIFACT_REF_PREFIX)) return null
  try {
    const value = JSON.parse(content.slice(ARTIFACT_REF_PREFIX.length)) as Partial<ArtifactReference>
    if (typeof value.artifactId !== 'string' || value.artifactId.length === 0) return null
    return {
      artifactId: value.artifactId,
      ...(typeof value.versionId === 'string' ? { versionId: value.versionId } : {}),
      ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
      ...(typeof value.pending === 'boolean' ? { pending: value.pending } : {}),
    }
  } catch {
    return null
  }
}

/** A completed reference supersedes the generation placeholder for the same artifact. */
export function getSupersededPendingArtifactMessageIds(
  messages: Array<{ id: string; content: string }>,
): Set<string> {
  const parsed = messages.map((message) => ({ message, ref: parseArtifactReference(message.content) }))
  const finalizedArtifactIds = new Set(
    parsed
      .filter(({ ref }) => Boolean(ref?.versionId))
      .map(({ ref }) => ref!.artifactId),
  )

  return new Set(
    parsed
      .filter(({ ref }) => ref?.pending === true && finalizedArtifactIds.has(ref.artifactId))
      .map(({ message }) => message.id),
  )
}
