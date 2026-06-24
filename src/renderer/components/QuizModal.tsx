import { useCallback, useEffect, useRef, useState } from 'react'
import { BrainCircuit, CheckCircle, Loader2, XCircle } from 'lucide-react'
import { ModalShell } from './ui/primitives'
import type { QuizAttempt, QuizQuestion, QuizResult } from '../../shared/types'

interface QuizModalProps {
  conversationId: string
  onClose: () => void
}

type Step = 'generating' | 'question' | 'feedback' | 'summary'

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

function formatAttemptDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function QuizModal({ conversationId, onClose }: QuizModalProps) {
  const [step, setStep] = useState<Step>('generating')
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [results, setResults] = useState<QuizResult[]>([])
  const [pastAttempts, setPastAttempts] = useState<QuizAttempt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [score, setScore] = useState(0)

  const generatedRef = useRef(false)
  const nextBtnRef = useRef<HTMLButtonElement>(null)

  const generate = useCallback(() => {
    generatedRef.current = true
    setError(null)
    setStep('generating')
    setQuestions([])
    setCurrentIndex(0)
    setSelectedIndex(null)
    setResults([])
    setScore(0)

    window.api.generateQuiz(conversationId)
      .then((res) => {
        if (res.questions.length === 0) {
          setError('No questions could be generated. Try generating a debrief first.')
          return
        }
        setQuestions(res.questions)
        setStep('question')
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to generate quiz')
      })
  }, [conversationId])

  useEffect(() => {
    if (generatedRef.current) return
    generate()
  }, [generate])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = useCallback(() => {
    if (selectedIndex === null) return
    const question = questions[currentIndex]
    const isCorrect = selectedIndex === question.correctIndex
    setResults((prev) => [...prev, { questionId: question.id, selectedIndex, correct: isCorrect }])
    setStep('feedback')
    setTimeout(() => nextBtnRef.current?.focus(), 50)
  }, [selectedIndex, questions, currentIndex])

  const handleNext = useCallback(async () => {
    const nextIndex = currentIndex + 1
    if (nextIndex < questions.length) {
      setCurrentIndex(nextIndex)
      setSelectedIndex(null)
      setStep('question')
    } else {
      const finalResults = [...results, { questionId: questions[currentIndex].id, selectedIndex: selectedIndex!, correct: selectedIndex === questions[currentIndex].correctIndex }]
      const finalScore = finalResults.filter((r) => r.correct).length
      setScore(finalScore)
      setStep('summary')

      try {
        await window.api.saveQuizAttempt(conversationId, finalScore, questions.length)
        const attempts = await window.api.listQuizAttempts(conversationId)
        setPastAttempts(attempts)
      } catch {
        // Non-fatal — summary still shows
      }
    }
  }, [currentIndex, questions, results, selectedIndex, conversationId])

  const currentQuestion = questions[currentIndex]
  const total = questions.length
  const isLastQuestion = currentIndex === total - 1

  const getCategoryColor = (cat: string) => CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.concept

  return (
    <ModalShell
      title="Quiz"
      icon={<BrainCircuit className="w-4 h-4" />}
      maxWidth="max-w-xl"
      height="h-auto"
      onClose={onClose}
    >
      {/* Generating */}
      {step === 'generating' && !error && (
        <div className="flex flex-col items-center justify-center gap-3 py-16" role="status" aria-live="polite">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Generating quiz questions…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center justify-center gap-4 py-12 px-5">
          <XCircle className="w-10 h-10 text-red-400" />
          <p className="text-sm text-red-500 text-center">{error}</p>
          <div className="flex gap-2">
            <button
              onClick={generate}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
            >
              Retry
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Question */}
      {step === 'question' && currentQuestion && (
        <div className="flex flex-col gap-4 p-5">
          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${((currentIndex) / total) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 shrink-0">{currentIndex + 1} / {total}</span>
          </div>

          {/* Category badge */}
          <span className={`self-start text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${getCategoryColor(currentQuestion.category)}`}>
            {currentQuestion.category}
          </span>

          {/* Question text */}
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-relaxed">{currentQuestion.question}</p>

          {/* Options */}
          <div className="flex flex-col gap-2">
            {currentQuestion.options.map((opt, i) => {
              const isSelected = selectedIndex === i
              return (
                <button
                  key={i}
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

          {/* Submit */}
          <div className="flex justify-end pt-1">
            <button
              onClick={handleSubmit}
              disabled={selectedIndex === null}
              style={{ opacity: selectedIndex === null ? 0.4 : 1, transition: 'opacity 200ms' }}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white disabled:cursor-not-allowed transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {step === 'feedback' && currentQuestion && selectedIndex !== null && (
        <div className="flex flex-col gap-4 p-5">
          {/* Correct/Incorrect banner */}
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
                  : <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                }
                <span className={`text-sm font-medium ${isCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                  {isCorrect ? 'Correct!' : 'Incorrect'}
                </span>
              </div>
            )
          })()}

          {/* Options with colors */}
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

          {/* Explanation */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-1">Explanation</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{currentQuestion.explanation}</p>
          </div>

          <div className="flex justify-end pt-1">
            <button
              ref={nextBtnRef}
              onClick={() => void handleNext()}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
            >
              {isLastQuestion ? 'See Results' : 'Next Question'}
            </button>
          </div>
        </div>
      )}

      {/* Summary */}
      {step === 'summary' && (
        <div className="flex flex-col gap-5 p-5">
          {/* Score */}
          <div className="text-center">
            <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">{score}<span className="text-2xl text-gray-400">/{total}</span></p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{getScoreLabel(score, total)}</p>
          </div>

          {/* Category breakdown */}
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

          {/* Past attempts */}
          {pastAttempts.length > 1 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">Recent Attempts</p>
              <div className="flex flex-wrap gap-2">
                {pastAttempts.slice(0, 3).map((attempt) => (
                  <span key={attempt.id} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {attempt.score}/{attempt.total} · {formatAttemptDate(attempt.attempted_at)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={generate}
              className="flex-1 px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  )
}
