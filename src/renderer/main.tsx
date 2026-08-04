import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { installGlobalErrorHandlers } from './lib/global-error-handlers'

// Avoid a flash of the 8-bit token set while persisted preferences hydrate.
document.documentElement.dataset.uiStyle ||= 'classic'
installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
