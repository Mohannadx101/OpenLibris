/// <reference types="vite/client" />

import type { OpenLibrisApi } from '@shared/api'

declare global {
  interface Window {
    /** Injected by the preload script. The renderer's only door to the main process. */
    api: OpenLibrisApi
  }
}
