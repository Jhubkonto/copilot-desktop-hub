import { useCallback, useMemo, useState } from 'react'
import { SLASH_COMMANDS } from '../slash-commands'

export function useSlashMenu() {
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0)

  const filteredSlashCommands = useMemo(() => {
    const filter = slashFilter.toLowerCase()
    return SLASH_COMMANDS.filter((cmd) => cmd.name.slice(1).startsWith(filter))
  }, [slashFilter])

  const openSlashMenu = useCallback((filter = '') => {
    setShowSlashMenu(true)
    setSlashFilter(filter)
    setSelectedSlashIndex(0)
  }, [])

  const closeSlashMenu = useCallback(() => {
    setShowSlashMenu(false)
    setSlashFilter('')
    setSelectedSlashIndex(0)
  }, [])

  return {
    showSlashMenu,
    slashFilter,
    selectedSlashIndex,
    filteredSlashCommands,
    openSlashMenu,
    closeSlashMenu,
    setSlashFilter,
    setSelectedSlashIndex,
  }
}
