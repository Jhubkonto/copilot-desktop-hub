import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// Avoid a flash of the 8-bit token set while persisted preferences hydrate.
document.documentElement.dataset.uiStyle ||= 'classic'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
