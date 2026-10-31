import type { Db } from '../db/connection'
import { getSchemaVersion } from '../db/migrate'
import type { Handlers } from './dispatch'

export interface AppHandlerDeps {
  db: Db
  appName: string
  appVersion: string
  dataDir: string
}

/** Handlers for the `app:*` channels. Later phases add library, reading, annotations, … */
export function createHandlers(deps: AppHandlerDeps): Handlers {
  return {
    'app:ping': ({ message }) => ({ reply: `pong: ${message}`, receivedAt: Date.now() }),

    'app:getInfo': () => ({
      name: deps.appName,
      version: deps.appVersion,
      platform: process.platform,
      schemaVersion: getSchemaVersion(deps.db),
      dataDir: deps.dataDir,
    }),
  }
}
