import { useState, useEffect, useCallback } from 'react'

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface ToastContainerProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

const TOAST_DURATION = 4000

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      role="status"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  const bgColor = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    info: 'bg-blue-600'
  }[toast.type]

  const icon = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  }[toast.type]

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-white text-sm ${bgColor} animate-slide-in`}
      role="alert"
    >
      <span className="font-bold">{icon}</span>
      <span>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="ml-2 text-white/70 hover:text-white"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

/**
 * Hook for managing toasts. Returns [toasts, addToast, dismissToast].
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, addToast, dismissToast }
}
