export type BrowserSyncEvent =
  | { type: 'session-attention.changed'; profile: string; sourceId: string }
  | { type: 'session-prefs.changed'; profile: string; sourceId: string }
  | { type: 'active-profile.changed'; profile: string; sourceId: string }
  | { type: 'theme.changed'; sourceId: string }

export interface BrowserSyncChannel<T extends { sourceId: string }> {
  sourceId: string
  publish(event: T): void
  subscribe(handler: (event: T) => void): () => void
  close(): void
}

function createSourceId(): string {
  try {
    const cryptoObj = globalThis.crypto as Crypto | undefined
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID()
  } catch {
    // ignore
  }
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function parseEvent<T>(value: string | null): T | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { event?: T }
    return parsed && typeof parsed === 'object' && 'event' in parsed ? (parsed.event as T) : null
  } catch {
    return null
  }
}

export function createBrowserSync<T extends { sourceId: string }>(name: string): BrowserSyncChannel<T> {
  const sourceId = createSourceId()
  const listeners = new Set<(event: T) => void>()
  const storageKey = `hermes.browserSync.${name}`
  let channel: BroadcastChannel | null = null
  let closed = false

  const notify = (event: T) => {
    if (closed) return
    for (const handler of Array.from(listeners)) {
      try { handler(event) } catch { /* isolate subscribers */ }
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return
    const parsed = parseEvent<T>(event.newValue)
    if (parsed) notify(parsed)
  }

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(name)
      channel.onmessage = (message: MessageEvent<T>) => {
        if (message.data) notify(message.data)
      }
    }
  } catch {
    channel = null
  }

  try {
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  } catch {
    // ignore
  }

  return {
    sourceId,
    publish(event: T) {
      if (closed) return
      notify(event)
      try { channel?.postMessage(event) } catch { /* ignore */ }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(storageKey, JSON.stringify({ event, at: Date.now() }))
        }
      } catch {
        // private mode/quota unavailable; BroadcastChannel/same-document still works
      }
    },
    subscribe(handler: (event: T) => void) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    close() {
      if (closed) return
      closed = true
      listeners.clear()
      try { channel?.close() } catch { /* ignore */ }
      try {
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      } catch {
        // ignore
      }
    },
  }
}
