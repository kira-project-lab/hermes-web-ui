// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  hasApiKey: vi.fn(() => true),
  isStoredSuperAdmin: vi.fn(() => true),
}))

import router from '@/router'

describe('session-first route navigation', () => {
  it('resolves the canonical new-session route to /session/new', () => {
    const resolved = router.resolve({ name: 'hermes.sessionNew' })
    expect(resolved.fullPath).toBe('/session/new')
  })

  it('keeps /chat as a legacy redirect to /session/new', () => {
    const legacyRoute = router.getRoutes().find(route => route.name === 'hermes.chat')
    expect(legacyRoute?.path).toBe('/chat')
    expect(legacyRoute?.redirect).toEqual({ name: 'hermes.sessionNew' })
  })

  it('keeps existing session URLs on the session route', () => {
    const resolved = router.resolve({ name: 'hermes.session', params: { sessionId: 'abc123' } })
    expect(resolved.fullPath).toBe('/session/abc123')
  })
})
