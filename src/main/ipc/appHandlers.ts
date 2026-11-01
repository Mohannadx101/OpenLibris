import type { Db } from '../db/connection'
import { getSchemaVersion } from '../db/migrate'
import type { ChannelsOf, HandlersFor } from './dispatch'

export interface AppHandlerDeps {
  db: Db
  appName: string
  appVersion: string
  dataDir: string
}

export function createAppHandlers(deps: AppHandlerDeps): HandlersFor<ChannelsOf<'app'>> {
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
