import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  rollback: () => ipcRenderer.invoke('failsafe:rollback'),
  dismiss: () => ipcRenderer.invoke('failsafe:dismiss'),
})
