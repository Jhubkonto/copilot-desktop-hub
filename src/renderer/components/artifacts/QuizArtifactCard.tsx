import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit, CheckCircle, Loader2, RefreshCw, XCircle } from 'lucide-react'
import type { ArtifactRow, QuizQuestion, QuizResult } from '@shared/types'

type Step = 'loading' | 'question' | 'feedback' | 'summary'

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
export function QuizArtifactCard({ artifactId, versionId: _versionId }: { artifactId: string; versionId?: string }) {
  const [artifact, setArtifact] = useState<ArtifactRow | null>(null)
  const [step, setStep] = useState<Step>('loading')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [results, setResults] = useState<QuizResult[]>([])
  const [score, setScore] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  const nextBtnRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(() => {
    setStep('loading')
    setError(null)
    window.api.artifactGet(artifactId)
      .then(async (a) => {
        if (!a) throw new Error('Artifact not found')
        setArtifact(a)
        const versionId = a.currentVersionId
        if (!versionId) throw new Error('Artifact has no content yet')
        const result = await window.api.artifactGetFileContent(versionId, 'quiz.json')
        const parsed = JSON.parse(result.content) as QuizQuestion[]
        setQuestions(parsed)
        setCurrentIndex(0)
        setSelectedIndex(null)
        setResults([])
        setScore(0)
        setStep('question')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load quiz')
      })
  }, [artifactId])

  useEffect(() => { load() }, [load])

  const handleSubmit = useCallback(() => {
    if (selectedIndex === null) return
    const question = questions[currentIndex]
    const isCorrect = selectedIndex === question.correctIndex
    setResults((prev) => [...prev, { questionId: question.id, selectedIndex, correct: isCorrect }])
    setStep('feedback')
    setTimeout(() => nextBtnRef.current?.focus(), 50)
  }, [selectedIndex, questions, currentIndex])

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
    }
  }, [currentIndex, questions, results, selectedIndex])

  const handleTryAgain = useCallback(() => {
    setCurrentIndex(0)
    setSelectedIndex(null)
    setResults([])
    setScore(0)
    setStep('question')
  }, [])

  const handleRegenerate = useCallback(async () => {
    const conversationId = artifact?.currentVersion?.sourceConversationId
    if (!conversationId) return
    setRegenerating(true)
    try {
      await window.api.generateQuiz(conversationId, artifact?.projectId ?? null)
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate quiz')
    } finally {
      setRegenerating(false)
    }
  }, [artifact, load])

  const currentQuestion = questions[currentIndex]
  const total = questions.length
  const isLastQuestion = currentIndex === total - 1
  const getCategoryColor = (cat: string) => CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.concept

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-4 rounded-lg border border-red-200 dark:border-red-800 max-w-xl">
        <XCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm text-red-500 text-center">{error}</p>
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 text-xs rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
        >
          Retry
        </button>
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
        {artifact.currentVersion && (
          <span className="text-[10px] text-gray-400 shrink-0">v{artifact.currentVersion.versionNumber}</span>
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
        </>
      )}
    </div>
  )
}
