import type { Bridge } from '@shared/bridge'

declare global {
  interface Window {
    bridge: Bridge
  }
}

export {}
