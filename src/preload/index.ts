import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { API_CHANNEL, EVENT_CHANNEL, type AppEvent } from '@shared/api'
import type { Bridge } from '@shared/bridge'

const bridge: Bridge = {
  invoke: (method, args) => ipcRenderer.invoke(API_CHANNEL, method, args),
  onEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, appEvent: AppEvent) => listener(appEvent)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler)
  },
}

contextBridge.exposeInMainWorld('bridge', bridge)
