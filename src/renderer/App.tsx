import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatWindow } from './components/ChatWindow'

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
  }

  return (
    <div className={`flex h-screen w-screen ${theme === 'dark' ? 'dark' : ''}`}>
      <Sidebar
        currentConversationId={currentConversationId}
        onSelectConversation={setCurrentConversationId}
        onNewChat={() => setCurrentConversationId(null)}
      />
      <main className="flex-1 flex flex-col bg-white dark:bg-gray-900">
        <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Copilot Desktop Hub
          </h1>
          <button
            onClick={toggleTheme}
            className="text-xs px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </header>
        <ChatWindow conversationId={currentConversationId} />
      </main>
    </div>
  )
}
