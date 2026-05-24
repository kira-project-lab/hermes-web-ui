import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

describe('session store title metadata', () => {
  let db: DatabaseSync | null = null

  beforeEach(async () => {
    vi.resetModules()
    db = new DatabaseSync(':memory:')
    vi.doMock('../../packages/server/src/db/index', () => ({
      getDb: () => db as DatabaseSync,
      getStoragePath: () => ':memory:',
      isSqliteAvailable: () => true,
    }))

    const { initAllHermesTables } = await import('../../packages/server/src/db/hermes/schemas')
    initAllHermesTables()
  })

  afterEach(() => {
    db?.close()
    db = null
    vi.doUnmock('../../packages/server/src/db/index')
    vi.resetModules()
  })

  it('keeps fallback metadata on create, preserves generated metadata, and clears it on rename', async () => {
    const mod = await import('../../packages/server/src/db/hermes/session-store')

    const created = mod.createSession({
      id: 'session-1',
      profile: 'default',
      source: 'cli',
      model: 'openai/gpt-5.4',
      provider: 'openrouter',
      title: 'Preview title',
    })

    expect(created.title).toBe('Preview title')
    expect(created.title_source).toBe('fallback')
    expect(created.title_generated_at).toBeNull()

    mod.updateSession('session-1', {
      title: 'Generated title',
      title_source: 'generated',
      title_generated_at: 1710000123,
    })

    const generated = mod.getSession('session-1')
    expect(generated?.title).toBe('Generated title')
    expect(generated?.title_source).toBe('generated')
    expect(generated?.title_generated_at).toBe(1710000123)

    expect(mod.renameSession('session-1', 'Manual title')).toBe(true)

    const renamed = mod.getSession('session-1')
    expect(renamed?.title).toBe('Manual title')
    expect(renamed?.title_source).toBe('manual')
    expect(renamed?.title_generated_at).toBeNull()
  })
})
