import { SLASH_COMMANDS, type SlashCommandDef } from '../../slash-commands'

interface SlashCommandMenuProps {
  show: boolean
  filter: string
  selectedIndex: number
  onSelect: (command: SlashCommandDef) => void
  onClose: () => void
  commands?: SlashCommandDef[]
}

export function SlashCommandMenu({
  show,
  filter,
  selectedIndex,
  onSelect,
  onClose,
  commands,
}: SlashCommandMenuProps) {
  if (!show) return null

  const visibleCommands = (commands ?? SLASH_COMMANDS)
    .filter((command) => command.name.slice(1).startsWith(filter.toLowerCase()))
    .slice(0, 8)

  if (visibleCommands.length === 0) {
    return (
      <div className="mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <button
          type="button"
          onClick={onClose}
          className="w-full text-left px-3 py-2 text-xs text-gray-600 dark:text-gray-300"
        >
          No matching slash commands
        </button>
      </div>
    )
  }

  return (
    <div
      id="slash-command-menu"
      role="listbox"
      aria-label="Slash commands"
      className="mb-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden"
    >
      {visibleCommands.map((command, index) => (
        <button
          key={command.name}
          id={`slash-opt-${index}`}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => onSelect(command)}
          className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
            index === selectedIndex
              ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <span className="font-mono">{command.name}</span>
          <span className="ml-3 text-gray-400">{command.description}</span>
        </button>
      ))}
    </div>
  )
}
