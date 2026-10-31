import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '@main/db/connection'
import type { Db } from '@main/db/connection'
import { loadBundledMigrations, runMigrations } from '@main/db/migrate'
import { SettingsRepository } from '@main/repositories/settingsRepository'

let db: Db
let settings: SettingsRepository

beforeEach(() => {
  db = openDatabase(':memory:')
  runMigrations(db, loadBundledMigrations())
  settings = new SettingsRepository(db)
})

afterEach(() => {
  db.close()
})

describe('SettingsRepository', () => {
  it('returns undefined for a missing key', () => {
    expect(settings.get('missing')).toBeUndefined()
  })

  it('round-trips structured values', () => {
    settings.set('tts', { voice: 'Samantha', rate: 1.25 })
    settings.set('fontSize', 18)
    settings.set('bedtime', false)
    expect(settings.get('tts')).toEqual({ voice: 'Samantha', rate: 1.25 })
    expect(settings.get('fontSize')).toBe(18)
    expect(settings.get('bedtime')).toBe(false)
  })

  it('overwrites an existing key', () => {
    settings.set('theme', 'light')
    settings.set('theme', 'sepia')
    expect(settings.get('theme')).toBe('sepia')
    expect(Object.keys(settings.getAll())).toEqual(['theme'])
  })

  it('deletes a key', () => {
    settings.set('theme', 'light')
    settings.delete('theme')
    expect(settings.get('theme')).toBeUndefined()
  })

  it('refuses values that cannot be stored as JSON', () => {
    expect(() => settings.set('bad', undefined)).toThrow(TypeError)
  })
})
