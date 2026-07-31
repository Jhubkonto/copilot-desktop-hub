import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Camera,
  ClipboardPaste,
  Ellipsis,
  Eye,
  File,
  FolderOpen,
  Package,
  type LucideIcon,
} from 'lucide-react'
import { useClickOutside } from '../../hooks/useClickOutside'

interface ComposerActionsMenuProps {
  disabled?: boolean
  showContextInspector: boolean
  onAttachFiles: () => void | Promise<void>
  onAttachFolder: () => void | Promise<void>
  onCaptureScreen?: () => void | Promise<void>
  onPasteClipboardImage?: () => void | Promise<void>
  onOpenPromptLibrary?: () => void
  onAttachArtifact?: () => void
  onToggleContextInspector: () => void
}

interface MenuAction {
  label: string
  icon: LucideIcon
  disabled?: boolean
  onSelect: () => void | Promise<void>
}

export function ComposerActionsMenu({
  disabled = false,
  showContextInspector,
  onAttachFiles,
  onAttachFolder,
  onCaptureScreen,
  onPasteClipboardImage,
  onOpenPromptLibrary,
  onAttachArtifact,
  onToggleContextInspector,
}: ComposerActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useClickOutside([buttonRef, menuRef], () => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const actions: MenuAction[] = [
    { label: 'Attach files', icon: File, disabled, onSelect: onAttachFiles },
    { label: 'Attach folder', icon: FolderOpen, disabled, onSelect: onAttachFolder },
    ...(onCaptureScreen
      ? [{ label: 'Capture screen', icon: Camera, disabled, onSelect: onCaptureScreen }]
      : []),
    ...(onPasteClipboardImage
      ? [{ label: 'Paste image from clipboard', icon: ClipboardPaste, disabled, onSelect: onPasteClipboardImage }]
      : []),
    ...(onOpenPromptLibrary
      ? [{ label: 'Insert prompt', icon: BookOpen, disabled, onSelect: onOpenPromptLibrary }]
      : []),
    ...(onAttachArtifact
      ? [{ label: 'Attach artifact', icon: Package, disabled, onSelect: onAttachArtifact }]
      : []),
    {
      label: showContextInspector ? 'Close context inspector' : 'Open context inspector',
      icon: Eye,
      onSelect: onToggleContextInspector,
    },
  ]

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`rounded-md p-1.5 transition-colors ${
          open || showContextInspector
            ? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300'
        }`}
        title="More message actions"
        aria-label="More message actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Ellipsis className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Message actions"
          className="absolute bottom-full left-0 z-30 mb-1 min-w-52 rounded-lg border border-gray-200 bg-white p-1 text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        >
          {actions.map(({ label, icon: Icon, disabled: actionDisabled, onSelect }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={actionDisabled}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800"
              onClick={() => {
                setOpen(false)
                void onSelect()
              }}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
