import { contextBridge, ipcRenderer } from 'electron'

const overlay = {
  ready: () => ipcRenderer.send('overlay:ready'),
  getScreenshot: (): Promise<string> => ipcRenderer.invoke('overlay:get-screenshot'),
  submit: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('overlay:submit', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  onScreenshotReady: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('overlay:screenshot-ready', handler)
    return () => ipcRenderer.removeListener('overlay:screenshot-ready', handler)
  },
}

contextBridge.exposeInMainWorld('overlay', overlay)
