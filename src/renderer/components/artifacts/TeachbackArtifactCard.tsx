import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Loader2, Mic, RefreshCw, RotateCcw, Square, Volume2, VolumeX, X } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion, TeachbackArtifactData, TeachbackAttempt, TeachbackFeedback } from '@shared/types'
import { isApiError } from '@shared/types'
import { useVoiceInput } from '../../hooks/useVoiceInput'

const RUBRIC_LABELS: Array<keyof TeachbackFeedback['rubric']> = ['accuracy', 'completeness', 'clarity']

export function TeachbackArtifactCard({ artifactId, versionId, pending = false }: { artifactId: string; versionId?: string; pending?: boolean }) {
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [version, setVersion] = useState<ArtifactVersion | null>(null)
  const [lockedVersion, setLockedVersion] = useState<{ artifactId: string; versionId: string } | null>(null)
  const [exercise, setExercise] = useState<TeachbackArtifactData | null>(null)
  const [transcript, setTranscript] = useState('')
  const [feedback, setFeedback] = useState<TeachbackFeedback | null>(null)
  const [attempts, setAttempts] = useState<TeachbackAttempt[]>([])
  const [currentPrompt, setCurrentPrompt] = useState('')
  const [turnNumber, setTurnNumber] = useState(0)
  const [parentAttemptId, setParentAttemptId] = useState<string | undefined>()
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [grading, setGrading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const lockedVersionId = lockedVersion?.artifactId === artifactId ? lockedVersion.versionId : null

  const onTranscript = useCallback((text: string) => {
    setTranscript(text)
    setFeedback(null)
    setVoiceError(null)
  }, [])
  const onVoiceError = useCallback((message: string) => setVoiceError(message), [])
  const { voiceState, toggleVoice, cancelVoice } = useVoiceInput(onTranscript, onVoiceError)

  const load = useCallback(() => {
    setError(null)
    window.api.artifactGet(artifactId)
      .then(async (nextArtifact) => {
        if (!nextArtifact) throw new Error('Artifact not found')
        setArtifact(nextArtifact)
        const isPendingThisVersion = pending && !versionId && !lockedVersionId
        if (nextArtifact.status === 'failed' && (isPendingThisVersion || !nextArtifact.currentVersionId)) {
          setError(nextArtifact.errorMessage ?? 'Teach-back generation failed')
          setVersion(null)
          setExercise(null)
          return
        }
        if (nextArtifact.status === 'generating' && isPendingThisVersion) {
          setVersion(null)
          setExercise(null)
          return
        }

        const targetVersionId = versionId ?? lockedVersionId ?? nextArtifact.currentVersionId
        if (!targetVersionId) {
          setVersion(null)
          setExercise(null)
          return
        }
        const targetVersion = versionId || lockedVersionId
          ? await window.api.artifactGetVersion(targetVersionId)
          : nextArtifact.currentVersion
        if (!targetVersion) throw new Error('Teach-back version not found')
        if (!versionId && !lockedVersionId) setLockedVersion({ artifactId, versionId: targetVersion.id })
        const file = await window.api.artifactGetFileContent(targetVersion.id, 'teachback.json')
        const nextExercise = JSON.parse(file.content) as TeachbackArtifactData
        const history = await window.api.getTeachbackAttempts(artifactId)
        const versionHistory = history.filter((attempt) => attempt.versionId === targetVersion.id)
        const latest = versionHistory.at(-1)
        setVersion(targetVersion)
        setExercise(nextExercise)
        setAttempts(versionHistory)
        if (latest) {
          setCurrentPrompt(latest.prompt)
          setTranscript(latest.transcript)
          setFeedback({ ...latest.feedback, attemptId: latest.id, prompt: latest.prompt, turnNumber: latest.turnNumber, attemptedAt: latest.attemptedAt })
          setTurnNumber(latest.turnNumber)
          setParentAttemptId(latest.parentAttemptId ?? latest.id)
        } else if (!lockedVersionId) {
          setCurrentPrompt(nextExercise.prompt)
          setTranscript('')
          setFeedback(null)
          setTurnNumber(0)
          setParentAttemptId(undefined)
        }
        setVoiceError(null)
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Failed to load teach-back exercise'))
  }, [artifactId, lockedVersionId, pending, versionId])

  useEffect(() => {
    setArtifact(null)
    setVersion(null)
    setLockedVersion(null)
    setExercise(null)
    setTranscript('')
    setFeedback(null)
    setAttempts([])
    setCurrentPrompt('')
    setTurnNumber(0)
    setParentAttemptId(undefined)
    window.speechSynthesis?.cancel()
    setSpeaking(false)
    setError(null)
    setVoiceError(null)
    void cancelVoice()
  }, [artifactId, cancelVoice, versionId])

  useEffect(() => { load() }, [load])

  useEffect(() => window.api.onArtifactUpdated(({ artifactId: updatedId }) => {
    if (updatedId === artifactId) load()
  }), [artifactId, load])

  useEffect(() => {
    if (!(pending && !versionId && !lockedVersionId && artifact?.status === 'generating')) return
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
  }, [artifact?.status, load, lockedVersionId, pending, versionId])

  const handleGrade = useCallback(async () => {
    if (!version || !transcript.trim()) return
    setGrading(true)
    setError(null)
    try {
      const result = await window.api.gradeTeachback(artifactId, version.id, transcript, currentPrompt, parentAttemptId, turnNumber)
      if (isApiError(result)) setError(result.error)
      else {
        setFeedback(result)
        if (result.attemptId) {
          setAttempts((previous) => [...previous, {
            id: result.attemptId!, artifactId, versionId: version.id,
            conversationId: version.sourceConversationId, projectId: artifact?.projectId ?? null,
            parentAttemptId: parentAttemptId ?? null, turnNumber,
            prompt: currentPrompt, transcript, feedback: result,
            attemptedAt: result.attemptedAt ?? Date.now(),
          }])
          setParentAttemptId((existing) => existing ?? result.attemptId)
        }
      }
    } catch (gradeError) {
      setError(gradeError instanceof Error ? gradeError.message : 'Failed to grade explanation')
    } finally {
      setGrading(false)
    }
  }, [artifact?.projectId, artifactId, currentPrompt, parentAttemptId, transcript, turnNumber, version])

  const toggleSpeech = useCallback(() => {
    if (!('speechSynthesis' in window) || !currentPrompt) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(currentPrompt)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }, [currentPrompt, speaking])

  const answerFollowUp = useCallback(async (question: string) => {
    await cancelVoice()
    window.speechSynthesis?.cancel()
    setSpeaking(false)
    setCurrentPrompt(question)
    setTurnNumber((turn) => turn + 1)
    setParentAttemptId((current) => current ?? feedback?.attemptId)
    setTranscript('')
    setFeedback(null)
    setError(null)
    setVoiceError(null)
  }, [cancelVoice, feedback?.attemptId])

  const handleRegenerate = useCallback(async () => {
    const conversationId = version?.sourceConversationId ?? artifact?.currentVersion?.sourceConversationId ?? artifact?.conversationId
    if (!conversationId) return
    await cancelVoice()
    setRegenerating(true)
    try {
      const result = await window.api.startTeachbackGeneration(conversationId, artifact?.projectId ?? null, undefined, exercise?.spec)
      if (isApiError(result)) setError(result.error)
      else load()
    } catch (regenerateError) {
      setError(regenerateError instanceof Error ? regenerateError.message : 'Failed to regenerate teach-back exercise')
    } finally {
      setRegenerating(false)
    }
  }, [artifact, cancelVoice, exercise?.spec, load, version])

  const resetAttempt = useCallback(async () => {
    await cancelVoice()
    setTranscript('')
    setFeedback(null)
    setCurrentPrompt(exercise?.prompt ?? '')
    setTurnNumber(0)
    setParentAttemptId(undefined)
    setError(null)
    setVoiceError(null)
  }, [cancelVoice, exercise?.prompt])

  const isPendingGenerating = pending && !versionId && !lockedVersionId && artifact?.status === 'generating'
  if (isPendingGenerating || !artifact || !exercise || !version) {
    if (error) {
      return <div className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-[11px] text-red-600 dark:text-red-300">{error}</div>
    }
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-900/10 text-[11px] text-teal-700 dark:text-teal-300">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {isPendingGenerating ? 'Generating teach-back…' : 'Loading teach-back…'}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/10 p-4 space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Mic className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{artifact.title}</p>
        <span className="text-[10px] text-gray-400 shrink-0">v{version.versionNumber}</span>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Explain in your own words</p>
        <div className="mt-1 flex items-start gap-2">
          <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap flex-1">{currentPrompt}</p>
          <button type="button" onClick={toggleSpeech} className="p-1.5 rounded-md text-teal-600 hover:bg-teal-100 dark:hover:bg-teal-900/30" title={speaking ? 'Stop speaking' : 'Read prompt aloud'} aria-label={speaking ? 'Stop speaking' : 'Read prompt aloud'}>
            {speaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
        {turnNumber > 0 && <p className="text-[10px] text-teal-600 dark:text-teal-400 mt-1">Viva follow-up {turnNumber} of 2</p>}
      </div>

      {!feedback && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setFeedback(null)
                setVoiceError(null)
                toggleVoice()
              }}
              disabled={voiceState === 'transcribing' || grading}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {voiceState === 'transcribing'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : voiceState === 'recording'
                  ? <Square className="w-3.5 h-3.5" />
                  : <Mic className="w-3.5 h-3.5" />}
              {voiceState === 'transcribing' ? 'Transcribing…' : voiceState === 'recording' ? 'Stop recording' : transcript ? 'Record again' : 'Record explanation'}
            </button>
            {voiceState === 'recording' && (
              <button
                type="button"
                onClick={() => void cancelVoice()}
                className="inline-flex items-center justify-center w-8 h-8 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                title="Cancel recording"
                aria-label="Cancel recording"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {voiceError && <p className="text-xs text-red-600 dark:text-red-400">{voiceError}</p>}
          {transcript && (
            <div className="space-y-2">
              <label htmlFor={`teachback-transcript-${artifactId}`} className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Transcript</label>
              <textarea
                id={`teachback-transcript-${artifactId}`}
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                rows={5}
                className="w-full resize-y rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                type="button"
                onClick={() => void handleGrade()}
                disabled={grading || !transcript.trim()}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {grading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                {grading ? 'Grading…' : 'Grade explanation'}
              </button>
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {feedback && (
        <div className="space-y-4 border-t border-teal-200 dark:border-teal-800 pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:divide-x divide-gray-200 dark:divide-gray-700">
            {RUBRIC_LABELS.map((name) => (
              <div key={name} className="sm:px-3 first:pl-0 last:pr-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">{name}</p>
                <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-0.5">{feedback.rubric[name].score}<span className="text-sm text-gray-400">/5</span></p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{feedback.rubric[name].feedback}</p>
              </div>
            ))}
          </div>

          {feedback.strengths.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">What landed</p>
              <ul className="mt-1 space-y-1 text-sm text-gray-700 dark:text-gray-300 list-disc pl-4">
                {feedback.strengths.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
          )}
          {feedback.corrections.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Corrections</p>
              <ul className="mt-1 space-y-1 text-sm text-gray-700 dark:text-gray-300 list-disc pl-4">
                {feedback.corrections.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
          )}
          {feedback.followUpQuestions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Probe deeper</p>
              <ul className="mt-1 space-y-1 text-sm text-gray-700 dark:text-gray-300 list-disc pl-4">
                {feedback.followUpQuestions.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
              {turnNumber < 2 && (
                <button type="button" onClick={() => void answerFollowUp(feedback.followUpQuestions[0])} className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700">
                  Answer next question
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {attempts.length > 0 && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {attempts.length} saved {attempts.length === 1 ? 'turn' : 'turns'} for this version · latest graded {new Date(attempts.at(-1)!.attemptedAt).toLocaleString()}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-teal-100 dark:border-teal-900/60">
        {(transcript || feedback) && (
          <button
            type="button"
            onClick={() => void resetAttempt()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-900/40 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleRegenerate()}
          disabled={regenerating || voiceState !== 'idle'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-900/40 disabled:opacity-50 transition-colors"
        >
          {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Regenerate
        </button>
      </div>
    </div>
  )
}
