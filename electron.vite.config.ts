import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
}

export default defineConfig({
  main: {
    resolve: { alias: { ...alias, '@main': resolve(__dirname, 'src/main') } },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react()],
  },
})
