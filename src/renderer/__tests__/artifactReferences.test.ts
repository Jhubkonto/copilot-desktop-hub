import { describe, expect, it } from 'vitest'
import {
  getSupersededPendingArtifactMessageIds,
  parseArtifactReference,
} from '../components/artifacts/artifactReferences'

describe('artifact chat references', () => {
  it('parses the artifact kind used by deleted tombstones', () => {
    expect(parseArtifactReference('__artifact-ref:{"artifactId":"a1","kind":"quiz","pending":true}')).toEqual({
      artifactId: 'a1',
      kind: 'quiz',
      pending: true,
    })
  })

  it('hides only a pending reference superseded by a finalized reference', () => {
    const hidden = getSupersededPendingArtifactMessageIds([
      { id: 'pending-a1', content: '__artifact-ref:{"artifactId":"a1","kind":"quiz","pending":true}' },
      { id: 'final-a1', content: '__artifact-ref:{"artifactId":"a1","versionId":"v1","kind":"quiz"}' },
      { id: 'pending-a2', content: '__artifact-ref:{"artifactId":"a2","pending":true}' },
      { id: 'attachment-a1', content: '__artifact-ref:{"artifactId":"a1"}' },
    ])

    expect(hidden).toEqual(new Set(['pending-a1']))
  })
})
