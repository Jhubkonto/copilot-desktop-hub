import { useMemo, useState } from 'react'
import type { UserInputAnswer } from '../../../shared/chat-turn-types'
import type { ChatTurnUserInput } from '../../hooks/chat-turn-reducer'

export function UserInputCard({ userInput }: { userInput: ChatTurnUserInput }) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const resolvedById = useMemo(
    () => new Map((userInput.answers ?? []).map((answer) => [answer.questionId, answer])),
    [userInput.answers],
  )
  const pending = userInput.status === 'pending'

  const submit = async () => {
    const answers: UserInputAnswer[] = userInput.request.questions.map((question) => ({
      questionId: question.id,
      selectedOptionIds: selected[question.id] ?? [],
      ...(texts[question.id]?.trim() ? { text: texts[question.id].trim() } : {}),
    }))
    setSubmitting(true)
    try {
      await window.api.respondToUserInput(userInput.request.requestId, answers)
    } finally {
      setSubmitting(false)
    }
  }

  const complete = userInput.request.questions.every((question) =>
    (selected[question.id]?.length ?? 0) > 0 || Boolean(texts[question.id]?.trim()))

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
      <div className="mb-3 font-medium text-gray-900 dark:text-gray-100">A little more information is needed</div>
      <div className="space-y-4">
        {userInput.request.questions.map((question) => {
          const resolved = resolvedById.get(question.id)
          return (
            <fieldset key={question.id} disabled={!pending || submitting}>
              {question.header && <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{question.header}</div>}
              <legend className="mb-2 text-gray-800 dark:text-gray-200">{question.prompt}</legend>
              <div className="space-y-1.5">
                {(question.options ?? []).map((option) => {
                  const current = pending ? selected[question.id] ?? [] : resolved?.selectedOptionIds ?? []
                  const checked = current.includes(option.id)
                  return (
                    <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded border border-transparent px-2 py-1.5 hover:border-blue-200 dark:hover:border-blue-800">
                      <input
                        className="mt-0.5"
                        type={question.selection === 'multiple' ? 'checkbox' : 'radio'}
                        name={`user-input-${userInput.request.requestId}-${question.id}`}
                        checked={checked}
                        onChange={() => setSelected((all) => ({
                          ...all,
                          [question.id]: question.selection === 'multiple'
                            ? checked ? current.filter((id) => id !== option.id) : [...current, option.id]
                            : [option.id],
                        }))}
                      />
                      <span><span className="font-medium">{option.label}</span>{option.description && <span className="block text-xs text-gray-500 dark:text-gray-400">{option.description}</span>}</span>
                    </label>
                  )
                })}
              </div>
              {question.allowFreeText && (
                <input
                  className="mt-2 w-full rounded border border-gray-300 bg-white px-2.5 py-2 text-gray-900 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  value={pending ? texts[question.id] ?? '' : resolved?.text ?? ''}
                  onChange={(event) => setTexts((all) => ({ ...all, [question.id]: event.target.value }))}
                  placeholder="Type your answer"
                />
              )}
            </fieldset>
          )
        })}
      </div>
      {pending ? (
        <button type="button" disabled={!complete || submitting} onClick={submit} className="mt-4 rounded bg-blue-600 px-3 py-1.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      ) : (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          {userInput.status === 'resolved' ? 'Answered' : userInput.reason ?? 'Cancelled'}
        </div>
      )}
    </div>
  )
}
