import { describe, expect, it, vi } from 'vitest'
import { emitSessionListChanged, emitSessionStatus, sessionRuntimeStatus, sessionRuntimeStatusSnapshot, sessionStatusRoom } from '../../packages/server/src/services/hermes/run-chat/status-feed'
import type { SessionState } from '../../packages/server/src/services/hermes/run-chat/types'

function state(overrides: Partial<SessionState> = {}): SessionState {
  return {
    messages: [],
    isWorking: false,
    events: [],
    queue: [],
    ...overrides,
  }
}

describe('chat run status feed helpers', () => {
  it('builds a profile-scoped room name', () => {
    expect(sessionStatusRoom('research')).toBe('profile:research:session-status')
  })

  it('serializes runtime status without message content', () => {
    const status = sessionRuntimeStatus('session-1', state({
      profile: 'research',
      isWorking: true,
      queue: [{ queue_id: 'q1', input: 'secret queued input', profile: 'research' }],
      pendingApproval: {
        approval_id: 'approval-1',
        command: 'touch file',
        description: 'Need permission',
        choices: ['once', 'deny'],
        allow_permanent: false,
        requested_at: 123,
      },
      messages: [{ id: 1, session_id: 'session-1', role: 'assistant', content: 'secret content', timestamp: 1 }],
      lastStatusUpdatedAt: 456,
    }))

    expect(status).toMatchObject({
      session_id: 'session-1',
      profile: 'research',
      isWorking: true,
      queueLength: 1,
      updatedAt: 456,
      pendingApproval: { approval_id: 'approval-1' },
    })
    expect(JSON.stringify(status)).not.toContain('secret content')
    expect(JSON.stringify(status)).not.toContain('secret queued input')
    expect(JSON.stringify(status)).not.toContain('touch file')
    expect(JSON.stringify(status)).not.toContain('Need permission')
  })

  it('snapshots only active statuses for the requested profile', () => {
    const sessions = new Map<string, SessionState>([
      ['working', state({ profile: 'research', isWorking: true })],
      ['approval', state({ profile: 'research', pendingApproval: { approval_id: 'a1', command: 'cmd', description: '', choices: ['deny'], allow_permanent: false } })],
      ['idle', state({ profile: 'research' })],
      ['other', state({ profile: 'personal', isWorking: true })],
    ])

    expect(sessionRuntimeStatusSnapshot('research', sessions).map(status => status.session_id)).toEqual(['working', 'approval'])
  })

  it('emits status to the profile room', () => {
    const emit = vi.fn()
    const to = vi.fn(() => ({ emit }))
    const nsp = { to } as any
    const sessionState = state({ profile: 'research', isWorking: true })

    emitSessionStatus(nsp, 'session-1', sessionState)

    expect(to).toHaveBeenCalledWith('profile:research:session-status')
    expect(emit).toHaveBeenCalledWith('session.status.updated', expect.objectContaining({
      session_id: 'session-1',
      profile: 'research',
      isWorking: true,
    }))
    expect(sessionState.lastStatusUpdatedAt).toEqual(expect.any(Number))
  })

  it('emits session list changed to the profile status room', () => {
    const emit = vi.fn()
    const to = vi.fn(() => ({ emit }))
    const nsp = { to } as any

    emitSessionListChanged(nsp, 'research', 'created', 'session-1')

    expect(to).toHaveBeenCalledWith('profile:research:session-status')
    expect(emit).toHaveBeenCalledWith('session.list.changed', {
      profile: 'research',
      reason: 'created',
      session_id: 'session-1',
      updatedAt: expect.any(Number),
    })
  })
})
