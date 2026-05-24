import type { Server } from 'socket.io'
import type { SessionState } from './types'

export function sessionStatusRoom(profile: string): string {
  return `profile:${profile}:session-status`
}

export type SessionListChangedReason = 'created' | 'renamed' | 'deleted' | 'updated' | 'cleared'

export interface SessionListChangedPayload {
  profile: string
  reason: SessionListChangedReason
  session_id?: string
  updatedAt: number
}

export function sessionRuntimeStatus(sessionId: string, state: SessionState) {
  const profile = state.profile || 'default'
  return {
    session_id: sessionId,
    profile,
    isWorking: Boolean(state.isWorking),
    isAborting: Boolean(state.isAborting),
    queueLength: state.queue?.length || 0,
    pendingApproval: state.pendingApproval
      ? {
          approval_id: state.pendingApproval.approval_id,
          command: '',
          description: '',
          choices: state.pendingApproval.choices,
          allow_permanent: state.pendingApproval.allow_permanent,
          requested_at: state.pendingApproval.requested_at,
        }
      : null,
    updatedAt: state.lastStatusUpdatedAt || Date.now(),
  }
}

export function sessionRuntimeStatusSnapshot(profile: string, sessionMap: Map<string, SessionState>) {
  const sessions = []
  for (const [sessionId, state] of sessionMap.entries()) {
    if ((state.profile || 'default') !== profile) continue
    if (!state.isWorking && !state.isAborting && !(state.queue?.length) && !state.pendingApproval) continue
    sessions.push(sessionRuntimeStatus(sessionId, state))
  }
  return sessions
}

export function emitSessionStatus(
  nsp: ReturnType<Server['of']>,
  sessionId: string,
  state: SessionState,
  profileOverride?: string,
) {
  const profile = profileOverride || state.profile || 'default'
  state.lastStatusUpdatedAt = Date.now()
  nsp.to(sessionStatusRoom(profile)).emit('session.status.updated', {
    ...sessionRuntimeStatus(sessionId, state),
    profile,
  })
}

export function emitSessionListChanged(
  nsp: ReturnType<Server['of']>,
  profile: string,
  reason: SessionListChangedReason,
  sessionId?: string,
): void {
  nsp.to(sessionStatusRoom(profile)).emit('session.list.changed', {
    profile,
    reason,
    session_id: sessionId,
    updatedAt: Date.now(),
  } satisfies SessionListChangedPayload)
}
