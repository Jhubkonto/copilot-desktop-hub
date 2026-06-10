import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { X } from 'lucide-react'

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

interface ModalShellProps {
  title: string
  description?: string
  icon?: ReactNode
  ariaLabel?: string
  maxWidth?: string
  height?: string
  bodyClassName?: string
  headerActions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}

export function ModalShell({
  title,
  description,
  icon,
  ariaLabel,
  maxWidth = 'max-w-5xl',
  height = 'h-[84vh]',
  bodyClassName = 'flex-1 min-h-0 overflow-y-auto p-5',
  headerActions,
  children,
  footer,
  onClose,
}: ModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
      onClick={onClose}
    >
      <div
        className={cx(
          'w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 flex flex-col',
          maxWidth,
          height,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center gap-2">
              {icon}
              {title}
            </h2>
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
          <div className="flex items-center gap-2">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label={`Close ${ariaLabel ?? title}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className={bodyClassName}>{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, children, ...props },
  ref,
) {
  const variantClass = {
    primary: 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200',
    secondary: 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700',
    ghost: 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
    danger: 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30',
  }[variant]

  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
        variantClass,
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
    </button>
  )
})

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100">{value}</p>
    </div>
  )
}

export function InfoRow({
  label,
  detail,
  value,
  children,
}: {
  label: string
  detail?: string
  value?: string
  children?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{label}</p>
          {detail && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 break-words">{detail}</p>}
        </div>
        {value && <span className="shrink-0 text-[11px] tabular-nums text-gray-400">{value}</span>}
      </div>
      {children}
    </div>
  )
}

interface FieldFrameProps {
  label?: string
  help?: string
  error?: string
  children: ReactNode
}

function FieldFrame({ label, help, error, children }: FieldFrameProps) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label}</span>}
      {children}
      {help && !error && <span className="mt-1 block text-[11px] text-gray-400">{help}</span>}
      {error && <span className="mt-1 block text-[11px] text-red-500">{error}</span>}
    </label>
  )
}

const fieldClass =
  'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  help?: string
  error?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, help, error, className, ...props },
  ref,
) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      <input ref={ref} className={cx(fieldClass, className)} {...props} />
    </FieldFrame>
  )
})

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  help?: string
  error?: string
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(function TextareaField(
  { label, help, error, className, ...props },
  ref,
) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      <textarea ref={ref} className={cx(fieldClass, 'resize-y leading-6', className)} {...props} />
    </FieldFrame>
  )
})

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  help?: string
  error?: string
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, help, error, className, children, ...props },
  ref,
) {
  return (
    <FieldFrame label={label} help={help} error={error}>
      <select ref={ref} className={cx(fieldClass, className)} {...props}>
        {children}
      </select>
    </FieldFrame>
  )
})

export function SegmentedTabs<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T
  items: Array<{ id: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-1 p-2 border-b border-gray-100 dark:border-gray-700">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cx(
            'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            value === item.id
              ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
