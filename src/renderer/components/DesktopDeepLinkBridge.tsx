import { useEffect } from 'react'
import { useAppStore } from '../store/app-store'

/** Routes main-process notification and protocol deep links into the active desktop chat. */
export function DesktopDeepLinkBridge() {
  const selectConversation = useAppStore((state) => state.selectConversation)

  useEffect(
    () => window.api.onOpenChatDeepLink((conversationId) => {
      selectConversation(conversationId)
    }),
    [selectConversation],
  )

  return null
}
