import { SLASH_COMMANDS, type SlashCommandDef } from '../../slash-commands'
import { slashCommandSourceLabel } from '../../provider-slash-commands'

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
    .slice(0, 12)

  if (visibleCommands.length === 0) {
    return (
      <div className="mb-2 overflow-hidden rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised text-nexy-text shadow-nexy">
        <button
          type="button"
          onClick={onClose}
          className="w-full px-3 py-2 text-left text-xs text-nexy-muted"
        >
          No matching slash commands
        </button>
      </div>
    )
  }

  // Section headers appear only when the list actually mixes sources — an all-built-in list
  // renders exactly as before, with no "Nexy" header noise.
  const hasMixedSources = visibleCommands.some(
    (command) => (command.source ?? 'nexy') !== (visibleCommands[0].source ?? 'nexy'),
  )

  return (
    <div
      id="slash-command-menu"
      role="listbox"
      aria-label="Slash commands"
      className="mb-2 max-h-72 overflow-y-auto rounded-nexy-sm border-2 border-nexy-border bg-nexy-raised text-nexy-text shadow-nexy"
    >
      {visibleCommands.map((command, index) => {
        const source = command.source ?? 'nexy'
        const previousSource = index > 0 ? (visibleCommands[index - 1].source ?? 'nexy') : null
        const showHeader = hasMixedSources && source !== previousSource
        return (
          <div key={`${source}-${command.name}`}>
            {showHeader && (
              <div className="nexy-font-status select-none border-t border-nexy-border px-3 pb-0.5 pt-2 text-nexy-muted first:border-t-0">
                {slashCommandSourceLabel(command.source)}
              </div>
            )}
            <button
              id={`slash-opt-${index}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => onSelect(command)}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between ${
                index === selectedIndex
                  ? 'bg-nexy-accent text-nexy-on-accent'
                  : 'text-nexy-muted hover:bg-nexy-recessed hover:text-nexy-text'
              }`}
            >
              <span className="font-mono">{command.name}</span>
              <span className="ml-3 text-nexy-muted">{command.description}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
