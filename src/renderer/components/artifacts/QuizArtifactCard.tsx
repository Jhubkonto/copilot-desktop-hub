import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit, CheckCircle, Loader2, RefreshCw, XCircle } from 'lucide-react'
import type { ArtifactRow, ArtifactVersion, QuizQuestion, QuizResult, QuizSpec, QuizAttempt, QuizCategoryBreakdown } from '@shared/types'

type Step = 'loading' | 'generating' | 'question' | 'feedback' | 'summary'

const CATEGORY_COLORS: Record<string, string> = {
  command: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  concept: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  sequence: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  approach: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
}

const OPTION_LABELS = ['A', 'B', 'C', 'D']

function getScoreLabel(score: number, total: number): string {
  const pct = total > 0 ? score / total : 0
  if (pct === 1) return 'Perfect!'
  if (pct >= 0.8) return 'Excellent!'
  if (pct >= 0.5) return 'Good work!'
  return 'Keep practicing'
}

/**
 * Renders a versioned quiz artifact as the same interactive question flow the old
 * QuizModal used, loading its stored question set instead of generating fresh ones on
 * open. "Try Again" re-walks the same questions; "Regenerate" reruns generation
 * (creating a new artifact version) and reloads this card in place.
 */
export function QuizArtifactCard({ artifactId, versionId, pending = false }: { artifactId: string; versionId?: string; pending?: boolean }) {
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [version, setVersion] = useState<ArtifactVersion | null>(null)
  const [lockedVersion, setLockedVersion] = useState<{ artifactId: string; versionId: string } | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [results, setResults] = useState<QuizResult[]>([])
  const [score, setScore] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [spec, setSpec] = useState<QuizSpec | null>(null)
  const [attempts, setAttempts] = useState<QuizAttempt[]>([])
  const recordedRef = useRef(false)

  const nextBtnRef = useRef<HTMLButtonElement>(null)
  const lockedVersionId = lockedVersion?.artifactId === artifactId ? lockedVersion.versionId : null

  const load = useCallback(() => {
    setError(null)
    window.api.artifactGet(artifactId)
      .then(async (a) => {
        if (!a) throw new Error('Artifact not found')
        setArtifact(a)

        const isPendingThisVersion = pending && !versionId && !lockedVersionId
        if (a.status === 'failed' && (isPendingThisVersion || !a.currentVersionId)) {
          setError(a.errorMessage ?? 'Quiz generation failed')
          setVersion(null)
          return
        }
        if (a.status === 'generating' && isPendingThisVersion) {
          setVersion(null)
          setStep('generating')
          return
        }

        const targetVersionId = versionId ?? lockedVersionId ?? a.currentVersionId
        if (!targetVersionId) {
          setVersion(null)
          setStep('loading')
          return
        }

        const targetVersion = versionId || lockedVersionId
          ? await window.api.artifactGetVersion(targetVersionId)
          : a.currentVersion
        if (!targetVersion) throw new Error('Quiz version not found')

        if (!versionId && !lockedVersionId) setLockedVersion({ artifactId, versionId: targetVersion.id })
        setVersion(targetVersion)
        const result = await window.api.artifactGetFileContent(targetVersion.id, 'quiz.json')
        const parsed = JSON.parse(result.content) as QuizQuestion[]
        setQuestions(parsed)
        // Best-effort: load the persisted spec so "Regenerate" reuses the same intent. Legacy
        // quizzes have no quiz-spec.json — fall back to null (regenerate uses defaults).
        try {
          const specFile = await window.api.artifactGetFileContent(targetVersion.id, 'quiz-spec.json')
          setSpec(JSON.parse(specFile.content) as QuizSpec)
        } catch {
          setSpec(null)
        }
        setCurrentIndex(0)
        setSelectedIndex(null)
        setResults([])
        setScore(0)
        recordedRef.current = false
        setStep('question')
        window.api.getQuizAttempts(artifactId).then(setAttempts).catch(() => setAttempts([]))
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load quiz')
      })
  }, [artifactId, lockedVersionId, pending, versionId])

  useEffect(() => {
    setArtifact(null)
    setVersion(null)
    setStep('loading')
    setQuestions([])
    setCurrentIndex(0)
    setSelectedIndex(null)
    setResults([])
    setScore(0)
    setError(null)
  }, [artifactId, versionId])

  useEffect(() => { load() }, [load])

  // The artifact is created with status 'generating' before the LLM call resolves, so this
  // card can be attached to the transcript immediately and survive the user navigating away
  // mid-generation. Refresh on the push event, with a poll as a fallback in case it's missed.
  useEffect(() => {
    return window.api.onArtifactUpdated(({ artifactId: updatedId }) => {
      if (updatedId === artifactId) load()
    })
  }, [artifactId, load])

  useEffect(() => {
    if (!(pending && !versionId && !lockedVersionId && step === 'generating')) return
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
  }, [step, load, lockedVersionId, pending, versionId])

  const handleSubmit = useCallback(() => {
    if (selectedIndex === null) return
    const question = questions[currentIndex]
    const isCorrect = selectedIndex === question.correctIndex
    setResults((prev) => [...prev, { questionId: question.id, selectedIndex, correct: isCorrect }])
    setStep('feedback')
    setTimeout(() => nextBtnRef.current?.focus(), 50)
  }, [selectedIndex, questions, currentIndex])

  // Persists one completed run to the learning-history store. Guarded so a single walk-through
  // records exactly once (handleNext can fire more than once on the final question); reset in
  // handleTryAgain so each fresh re-walk counts as its own attempt.
  const recordAttempt = useCallback((finalResults: QuizResult[]) => {
    if (recordedRef.current) return
    const versionId = version?.id
    if (!versionId) return
    recordedRef.current = true
    // Align to one result per question (finalResults can carry a trailing duplicate of the
    // last answer depending on submit/next timing).
    const aligned = finalResults.slice(0, questions.length)
    const breakdown: QuizCategoryBreakdown = {}
    const missed: string[] = []
    questions.forEach((q, i) => {
      if (!breakdown[q.category]) breakdown[q.category] = { correct: 0, total: 0 }
      breakdown[q.category].total++
      if (aligned[i]?.correct) breakdown[q.category].correct++
      else missed.push(q.question)
    })
    window.api.recordQuizAttempt({
      artifactId,
      versionId,
      conversationId: version?.sourceConversationId ?? artifact?.conversationId ?? null,
      projectId: artifact?.projectId ?? null,
      score: aligned.filter((r) => r.correct).length,
      total: questions.length,
      categoryBreakdown: breakdown,
      missedQuestions: missed,
    }).then((a) => setAttempts((prev) => [a, ...prev])).catch(() => { /* history is best-effort */ })
  }, [artifactId, questions, version, artifact])

  const handleNext = useCallback(() => {
    const nextIndex = currentIndex + 1
    if (nextIndex < questions.length) {
      setCurrentIndex(nextIndex)
      setSelectedIndex(null)
      setStep('question')
    } else {
      const finalResults = [...results, { questionId: questions[currentIndex].id, selectedIndex: selectedIndex!, correct: selectedIndex === questions[currentIndex].correctIndex }]
      setScore(finalResults.filter((r) => r.correct).length)
      setStep('summary')
      recordAttempt(finalResults)
    }
  }, [currentIndex, questions, results, selectedIndex, recordAttempt])

  const handleTryAgain = useCallback(() => {
    setCurrentIndex(0)
    setSelectedIndex(null)
    setResults([])
    setScore(0)
    recordedRef.current = false
    setStep('question')
  }, [])

  const handleRegenerate = useCallback(async () => {
    const conversationId = version?.sourceConversationId ?? artifact?.currentVersion?.sourceConversationId ?? artifact?.conversationId
    if (!conversationId) return
    setRegenerating(true)
    try {
      await window.api.startQuizGeneration(conversationId, artifact?.projectId ?? null, undefined, spec ?? undefined, artifactId)
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate quiz')
    } finally {
      setRegenerating(false)
    }
  }, [artifact, artifactId, load, version, spec])

  // Generates a fresh quiz that re-tests the concepts from the questions just missed. Uses the
  // most recent attempt's missed list, threaded through the spec's focusQuestions.
  const handleRequizMissed = useCallback(async () => {
    const conversationId = version?.sourceConversationId ?? artifact?.currentVersion?.sourceConversationId ?? artifact?.conversationId
    const missed = attempts[0]?.missedQuestions ?? []
    if (!conversationId || missed.length === 0) return
    setRegenerating(true)
    try {
      await window.api.startQuizGeneration(conversationId, artifact?.projectId ?? null, undefined, {
        ...(spec ?? {}),
        focusQuestions: missed,
      }, artifactId)
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate follow-up quiz')
    } finally {
      setRegenerating(false)
    }
  }, [artifact, artifactId, attempts, load, version, spec])

  const currentQuestion = questions[currentIndex]
  const total = questions.length
  const bestScore = attempts.length > 0 ? Math.max(...attempts.map((a) => (a.total > 0 ? a.score / a.total : 0))) : null
  const missedInLatest = attempts[0]?.missedQuestions ?? []
  const historicalBreakdown = attempts.reduce<QuizCategoryBreakdown>((totals, attempt) => {
    Object.entries(attempt.categoryBreakdown).forEach(([category, value]) => {
      if (!totals[category]) totals[category] = { correct: 0, total: 0 }
      totals[category].correct += value.correct
      totals[category].total += value.total
    })
    return totals
  }, {})
  const isLastQuestion = currentIndex === total - 1
  const getCategoryColor = (cat: string) => CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.concept

  if (error) {
    const canRegenerate = artifact?.status === 'failed' && Boolean(version?.sourceConversationId ?? artifact.currentVersion?.sourceConversationId ?? artifact.conversationId)
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-4 rounded-lg border border-red-200 dark:border-red-800 max-w-xl">
        <XCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-red-500 text-center">{error}</p>
        <button
          type="button"
          onClick={() => (canRegenerate ? void handleRegenerate() : load())}
          disabled={regenerating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-50 transition-colors"
        >
          {regenerating && <Loader2 className="w-3 h-3 animate-spin" />}
          {canRegenerate ? 'Try again' : 'Retry'}
        </button>
      </div>
    )
  }

  if (step === 'generating') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/10 text-[11px] text-indigo-600 dark:text-indigo-300 max-w-xl">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Generating quiz…
      </div>
    )
  }

  if (step === 'loading' || !artifact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[11px] text-gray-400 max-w-xl">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading quiz…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-900/10 p-4 space-y-4 max-w-xl">
      <div className="flex items-center gap-2">
        <BrainCircuit className="w-4 h-4 text-indigo-500 shrink-0" />
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1 truncate">{artifact.title}</p>
        {(version ?? artifact.currentVersion) && (
          <span className="text-[10px] text-gray-400 shrink-0">v{(version ?? artifact.currentVersion)!.versionNumber}</span>
        )}
      </div>

      {step === 'question' && currentQuestion && (
        <>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${(currentIndex / total) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 shrink-0">{currentIndex + 1} / {total}</span>
          </div>

          <span className={`self-start inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${getCategoryColor(currentQuestion.category)}`}>
            {currentQuestion.category}
          </span>

          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-relaxed">{currentQuestion.question}</p>

          <div className="flex flex-col gap-2">
            {currentQuestion.options.map((opt, i) => {
              const isSelected = selectedIndex === i
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedIndex(i)}
                  className={`flex items-center gap-3 w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-gray-900 dark:text-gray-100'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                    isSelected ? 'bg-indigo-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}>
                    {OPTION_LABELS[i]}
                  </span>
                  {opt}
                </button>
              )
            })}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={selectedIndex === null}
              style={{ opacity: selectedIndex === null ? 0.4 : 1, transition: 'opacity 200ms' }}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white disabled:cursor-not-allowed transition-colors"
            >
              Submit
            </button>
          </div>
        </>
      )}

      {step === 'feedback' && currentQuestion && selectedIndex !== null && (
        <>
          {(() => {
            const isCorrect = selectedIndex === currentQuestion.correctIndex
            return (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                isCorrect
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
              }`}>
                {isCorrect
                  ? <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                <span className={`text-sm font-medium ${isCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {isCorrect ? 'Correct!' : 'Incorrect'}
                </span>
              </div>
            )
          })()}

          <div className="flex flex-col gap-2">
            {currentQuestion.options.map((opt, i) => {
              const isCorrect = i === currentQuestion.correctIndex
              const isWrongSelected = i === selectedIndex && selectedIndex !== currentQuestion.correctIndex
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    isCorrect
                      ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-gray-900 dark:text-gray-100'
                      : isWrongSelected
                        ? 'border-red-400 bg-red-50 dark:bg-red-900/20 text-gray-700 dark:text-gray-300'
                        : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                    isCorrect ? 'bg-emerald-500 text-white' : isWrongSelected ? 'bg-red-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                  }`}>
                    {OPTION_LABELS[i]}
                  </span>
                  {opt}
                </div>
              )
            })}
          </div>

          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-1">Explanation</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{currentQuestion.explanation}</p>
          </div>

          <div className="flex justify-end">
            <button
              ref={nextBtnRef}
              type="button"
              onClick={handleNext}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
            >
              {isLastQuestion ? 'See Results' : 'Next Question'}
            </button>
          </div>
        </>
      )}

      {step === 'summary' && (
        <>
          <div className="text-center">
            <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">{score}<span className="text-2xl text-gray-400">/{total}</span></p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{getScoreLabel(score, total)}</p>
            {attempts.length > 1 && bestScore !== null && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                {attempts.length} attempts · best {Math.round(bestScore * 100)}%
              </p>
            )}
          </div>

          {questions.length > 0 && (() => {
            const breakdown: Record<string, { correct: number; total: number }> = {}
            questions.forEach((q, i) => {
              if (!breakdown[q.category]) breakdown[q.category] = { correct: 0, total: 0 }
              breakdown[q.category].total++
              if (results[i]?.correct) breakdown[q.category].correct++
            })
            const categories = Object.entries(breakdown)
            return (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">By Category</p>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map(([cat, { correct, total: catTotal }]) => (
                    <div key={cat} className={`rounded-lg px-3 py-2 ${getCategoryColor(cat)}`}>
                      <p className="text-xs font-semibold capitalize">{cat}</p>
                      <p className="text-lg font-bold">{correct}<span className="text-sm font-normal opacity-70">/{catTotal}</span></p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {Object.keys(historicalBreakdown).length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">History by Category</p>
              <div className="space-y-1.5">
                {Object.entries(historicalBreakdown).map(([category, value]) => {
                  const percentage = value.total > 0 ? Math.round((value.correct / value.total) * 100) : 0
                  return (
                    <div key={category} className="flex items-center gap-2 text-xs">
                      <span className="capitalize text-gray-600 dark:text-gray-300 flex-1">{category}</span>
                      <span className="text-gray-400">{value.correct}/{value.total}</span>
                      <span className="w-9 text-right font-semibold text-gray-700 dark:text-gray-200">{percentage}%</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTryAgain}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={regenerating}
              className="flex items-center justify-center gap-1.5 flex-1 px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-50 transition-colors"
            >
              {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Regenerate
            </button>
          </div>

          {missedInLatest.length > 0 && (
            <button
              type="button"
              onClick={() => void handleRequizMissed()}
              disabled={regenerating}
              className="flex items-center justify-center gap-1.5 w-full px-4 py-2 text-sm rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 transition-colors"
            >
              {regenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5" />}
              Re-quiz the {missedInLatest.length} I missed
            </button>
          )}
        </>
      )}
    </div>
  )
}
