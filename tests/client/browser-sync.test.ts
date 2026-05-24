// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserSync, type BrowserSyncEvent } from '@/utils/browser-sync'

const channels: Array<{ close: () => void }> = []

afterEach(() => {
  channels.splice(0).forEach(channel => channel.close())
  localStorage.clear()
})

function makeSync(name = `test-${Math.random()}`) {
  const sync = createBrowserSync<BrowserSyncEvent>(name)
  channels.push(sync)
  return sync
}

describe('browser sync channel', () => {
  it('creates a stable sourceId', () => {
    const sync = makeSync()
    expect(sync.sourceId).toEqual(expect.any(String))
    const first = sync.sourceId
    sync.publish({ type: 'theme.changed', sourceId: sync.sourceId })
    expect(sync.sourceId).toBe(first)
  })

  it('notifies local subscribers when publishing an event', () => {
    const sync = makeSync()
    const seen: BrowserSyncEvent[] = []
    const stop = sync.subscribe(event => seen.push(event))

    sync.publish({ type: 'session-attention.changed', profile: 'kira', sourceId: sync.sourceId })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'session-attention.changed', profile: 'kira' })
    stop()
  })

  it('includes sourceId so consumers can ignore their own events', () => {
    const sync = makeSync()
    const seen: BrowserSyncEvent[] = []
    sync.subscribe(event => {
      if (event.sourceId !== sync.sourceId) seen.push(event)
    })

    sync.publish({ type: 'session-prefs.changed', profile: 'kira', sourceId: sync.sourceId })

    expect(seen).toEqual([])
  })

  it('ignores invalid JSON and unrelated storage keys', () => {
    const sync = makeSync('storage-test')
    const seen = vi.fn()
    sync.subscribe(seen)

    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '{bad' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'hermes.browserSync.storage-test', newValue: '{bad' }))

    expect(seen).not.toHaveBeenCalled()
  })

  it('receives valid storage fallback events', () => {
    const sync = makeSync('storage-valid')
    const seen: BrowserSyncEvent[] = []
    sync.subscribe(event => seen.push(event))
    const event: BrowserSyncEvent = { type: 'active-profile.changed', profile: 'study', sourceId: 'other' }

    window.dispatchEvent(new StorageEvent('storage', {
      key: 'hermes.browserSync.storage-valid',
      newValue: JSON.stringify({ event, at: Date.now() }),
    }))

    expect(seen).toEqual([event])
  })
})
