# Web UI State Sync Foundation Implementation Plan

> **For Hermes:** Use `subagent-driven-development` to implement this plan task-by-task. Keep commits small and run the specified tests after each task.

**Goal:** Build a correct synchronization foundation for Hermes Web UI so multi-tab/window state does not feel stale: local user state syncs cross-tab, and server/runtime session statuses are delivered to every relevant chat list without requiring every tab to open every session.

**Architecture:** Split synchronization into three layers: (1) tab-local route/UI state, (2) browser-local but cross-tab state via `storage` + `BroadcastChannel`, and (3) server-authoritative runtime status via a profile-level Socket.IO feed. Do not make every store globally realtime; first centralize the primitives and then migrate the highest-impact surfaces: chat session attention, session pins, active profile, and chat session-list runtime status.

**Tech Stack:** Vue 3, Pinia, TypeScript, Socket.IO, localStorage, BroadcastChannel, Playwright, Vitest.

---

## Current Behavior Summary

### Main problem

Hermes Web UI currently has a mixed state model:

- Some state is tab-local Pinia runtime state.
- Some state is persisted to localStorage.
- Some active entity events are delivered via socket rooms.
- There is almost no cross-tab synchronization (`BroadcastChannel` and `storage` listener are absent).
- Chat runtime events are session-room scoped, so a tab must open/resume a session before it receives that session's events.

Result: a user with multiple tabs/windows can see stale session statuses, unread indicators, pins, profile selection, or list state until reload/focus/manual navigation.

### Existing high-impact files

Client:

- `packages/client/src/stores/hermes/chat.ts`
- `packages/client/src/api/hermes/chat.ts`
- `packages/client/src/stores/hermes/session-browser-prefs.ts`
- `packages/client/src/stores/hermes/profiles.ts`
- `packages/client/src/views/hermes/ChatView.vue`
- `packages/client/src/components/hermes/chat/ChatPanel.vue`
- `packages/client/src/stores/hermes/kanban.ts`
- `packages/client/src/stores/hermes/group-chat.ts`

Server:

- `packages/server/src/services/hermes/run-chat/index.ts`
- `packages/server/src/services/hermes/run-chat/handle-bridge-run.ts`
- `packages/server/src/services/hermes/run-chat/handle-api-run.ts`
- `packages/server/src/services/hermes/run-chat/session-command.ts`
- `packages/server/src/services/hermes/run-chat/types.ts`

Tests to extend/create:

- `tests/client/chat-session-attention.test.ts`
- `tests/client/session-browser-prefs.test.ts` (new)
- `tests/client/profiles-store-sync.test.ts` (new, if practical)
- `tests/client/chat-status-sync.test.ts` (new)
- `tests/e2e/session-attention-states.spec.ts`
- `tests/e2e/chat-session-multitab.spec.ts`

---

## Product State Policy

Use this policy to avoid future confusion:

| State class | Examples | Correct sync source |
|---|---|---|
| Tab-local | active route, focused message, scroll position, open modal, current draft | current tab only |
| Browser-local user prefs | theme, sidebar collapse, pinned sessions, human-only filter, read/unread receipts | localStorage + `storage` listener + `BroadcastChannel` |
| Server-authoritative data | sessions, titles, workspace, model, deletion, message history | API fetch + server events |
| Runtime server status | working, queue, approval, aborting, live run status | profile-level Socket.IO status feed + resume snapshot |

Important rules:

1. `activeSessionId` is tab-local route state; do not sync it across tabs.
2. `read/unread` is user-local and should sync across tabs/windows.
3. `approval` must remain server/runtime-derived, not persisted to localStorage.
4. `working` must not depend on only the tab that started/opened a run.
5. Session-list indicators should be correct even when a tab has not opened the session.

---

## Target Architecture

### Client browser-local sync primitive

Create a small shared utility, not ad-hoc listeners in every store.

Proposed file:

```text
packages/client/src/utils/browser-sync.ts
```

Responsibilities:

- Wrap `BroadcastChannel` if available.
- Fall back to same-document callbacks + `storage` events for other documents.
- Provide typed-ish event names.
- Do not throw in SSR/tests/private mode.

Suggested event names:

```ts
export type BrowserSyncEvent =
  | { type: 'session-attention.changed'; profile: string; sourceId: string }
  | { type: 'session-prefs.changed'; profile: string; sourceId: string }
  | { type: 'active-profile.changed'; profile: string; sourceId: string }
  | { type: 'theme.changed'; sourceId: string }
```

Avoid loops by including a per-tab `sourceId`.

### Server runtime status feed

Extend `/chat-run` Socket.IO namespace with a profile-level room:

```text
profile:${profile}:session-status
```

Client subscribes once per active profile:

```ts
socket.emit('subscribe_status', { profile })
```

Server responds with a snapshot and emits deltas:

```ts
type SessionRuntimeStatus = {
  session_id: string
  profile: string
  isWorking: boolean
  isAborting?: boolean
  queueLength?: number
  pendingApproval?: {
    approval_id: string
    command: string
    description: string
    choices: string[]
    allow_permanent: boolean
    requested_at?: number
  } | null
  updatedAt: number
}
```

Events:

```text
session.status.snapshot
session.status.updated
```

Status updates should be emitted on:

- `run.started`
- `run.queued`
- `approval.requested`
- `approval.resolved`
- `run.completed`
- `run.failed`
- `abort.started`
- `abort.completed`
- session command paths that affect working/compression/queue state

Out of scope for this PR:

- Cross-device persistent read receipts.
- Server-side unread counts.
- Browser notifications.
- Rewriting all stores to a global sync framework.
- Making active route/session selection sync across tabs.

---

## Acceptance Criteria

1. Reading/opening a session in one tab clears unread in other tabs for the same profile without reload.
2. Marking a background session unread in one tab updates other tabs for the same profile without reload.
3. Pin/unpin state updates in other tabs for the same profile without reload.
4. Active profile change in one tab is detected by other tabs and reloads profile-scoped user state.
5. A tab showing the chat session list receives `working` status for sessions started in another tab/window.
6. A tab showing the chat session list receives `approval` status for a background session without opening that session.
7. Resolving approval in one tab clears approval in other tabs without reload.
8. `approval` remains runtime-only and is not persisted to localStorage.
9. Existing same-session streaming behavior still works.
10. Existing native session links / middle-click behavior still works.
11. Existing Kanban event stream behavior is not changed.
12. Group Chat current-room realtime behavior is not regressed.

---

## Task 1 — Add browser-local sync utility

**Objective:** Create a reusable cross-tab communication primitive with BroadcastChannel + storage fallback.

**Files:**

- Create: `packages/client/src/utils/browser-sync.ts`
- Test: `tests/client/browser-sync.test.ts`

**Step 1: Write failing tests**

Test cases:

1. `createBrowserSync('x')` creates a stable `sourceId`.
2. `publish(event)` delivers to same-document subscribers.
3. events from the same `sourceId` can be ignored by consumer logic.
4. storage event parsing ignores invalid JSON / unrelated keys.

Sketch:

```ts
it('notifies local subscribers when publishing an event', () => {
  const sync = createBrowserSync('test-channel')
  const seen: BrowserSyncEvent[] = []
  const stop = sync.subscribe(event => seen.push(event))

  sync.publish({ type: 'session-attention.changed', profile: 'kira', sourceId: sync.sourceId })

  expect(seen).toHaveLength(1)
  stop()
})
```

**Step 2: Verify RED**

Run:

```bash
npm test -- tests/client/browser-sync.test.ts
```

Expected: FAIL because file/module does not exist.

**Step 3: Implement utility**

Suggested public API:

```ts
export interface BrowserSyncChannel<T extends { sourceId: string }> {
  sourceId: string
  publish(event: T): void
  subscribe(handler: (event: T) => void): () => void
  close(): void
}

export function createBrowserSync<T extends { sourceId: string }>(name: string): BrowserSyncChannel<T>
```

Implementation notes:

- Use `crypto.randomUUID()` if available; fallback to timestamp/random.
- Broadcast through `BroadcastChannel` if available.
- Also write a short-lived localStorage value under `hermes.browserSync.${name}` so other tabs receive `storage` event even if BroadcastChannel is unavailable.
- Call same-document listeners directly on publish because `storage` does not fire in the same document.
- Catch storage errors.

**Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/client/browser-sync.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/client/src/utils/browser-sync.ts tests/client/browser-sync.test.ts
git commit -m "feat: add browser sync channel utility"
```

---

## Task 2 — Sync session read/unread across tabs

**Objective:** Make `sessionAttentionState` read/unread changes propagate across windows for the same profile.

**Files:**

- Modify: `packages/client/src/stores/hermes/chat.ts`
- Test: `tests/client/chat-session-attention.test.ts`

**Step 1: Write failing tests**

Add tests for:

1. `markSessionUnread('s1')` publishes `session-attention.changed`.
2. receiving `session-attention.changed` for the current profile calls `loadSessionAttentionState()` and updates unread state.
3. receiving event for a different profile does nothing.
4. self-origin event does not loop.

Test strategy:

- Mock `@/utils/browser-sync` with controllable subscribe/publish.
- Or use real utility and dispatch synthetic storage/BroadcastChannel events if test environment allows.

**Step 2: Verify RED**

Run:

```bash
npm test -- tests/client/chat-session-attention.test.ts
```

Expected: new tests fail.

**Step 3: Implement**

In `chat.ts`:

- Instantiate browser sync once in store setup.
- Publish after `persistSessionAttentionState()` changes read/unread state.
- Subscribe to `session-attention.changed`; if profile matches current profile and source differs, call `loadSessionAttentionState()`.
- Keep approval out of localStorage and browser sync payload.

Pseudo-code:

```ts
const browserSync = createBrowserSync<BrowserSyncEvent>('hermes-ui')

function publishSessionAttentionChanged() {
  browserSync.publish({
    type: 'session-attention.changed',
    profile: getProfileName(),
    sourceId: browserSync.sourceId,
  })
}
```

Call after persistence in `markSessionUnread` and `markSessionRead` only when state actually changed.

**Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/client/chat-session-attention.test.ts tests/client/browser-sync.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/client/src/stores/hermes/chat.ts tests/client/chat-session-attention.test.ts
git commit -m "feat: sync session read state across tabs"
```

---

## Task 3 — Sync session browser prefs across tabs

**Objective:** Make pinned sessions and human-only preference update in other tabs for the same profile.

**Files:**

- Modify: `packages/client/src/stores/hermes/session-browser-prefs.ts`
- Test: `tests/client/session-browser-prefs.test.ts`

**Step 1: Write failing tests**

Test cases:

1. `togglePinned('s1')` publishes `session-prefs.changed`.
2. external `session-prefs.changed` reloads `pinnedIds` for same profile.
3. external `session-prefs.changed` reloads `humanOnly` for same profile.
4. different-profile event is ignored.

**Step 2: Verify RED**

Run:

```bash
npm test -- tests/client/session-browser-prefs.test.ts
```

Expected: FAIL.

**Step 3: Implement**

- Use same browser sync utility.
- Publish after `persistPins()` and `persistHumanOnly()`.
- Subscribe and call `reload()` for matching profile/different source.

Do not sync active route/selected session.

**Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/client/session-browser-prefs.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/client/src/stores/hermes/session-browser-prefs.ts tests/client/session-browser-prefs.test.ts
git commit -m "feat: sync session browser prefs across tabs"
```

---

## Task 4 — Sync active profile changes across tabs

**Objective:** Detect active profile changes from another tab and reload profile-scoped stores/state without syncing active routes.

**Files:**

- Modify: `packages/client/src/stores/hermes/profiles.ts`
- Modify: `packages/client/src/stores/hermes/chat.ts` if needed
- Test: `tests/client/profiles-store-sync.test.ts`

**Step 1: Write failing tests**

Test cases:

1. `setActiveProfile('study')` publishes `active-profile.changed`.
2. receiving external `active-profile.changed` updates `activeProfileName` and `activeProfile`.
3. chat attention reloads when active profile changes.
4. session browser prefs reload when active profile changes already covered by existing watcher.

**Step 2: Verify RED**

Run:

```bash
npm test -- tests/client/profiles-store-sync.test.ts tests/client/chat-session-attention.test.ts
```

Expected: FAIL.

**Step 3: Implement**

- Publish from `setActiveProfile` after successful API call/localStorage update.
- Subscribe in profiles store.
- On external active-profile event:
  - update `activeProfileName`;
  - update `activeProfile` from known profiles if possible;
  - persist localStorage if needed;
  - fetch profiles if current list is empty/stale.
- In chat store, add watcher on profiles store activeProfileName to `loadSessionAttentionState()` and optionally `loadSessions()` only when chat view asks for it. Avoid surprise route changes.

**Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/client/profiles-store-sync.test.ts tests/client/chat-session-attention.test.ts tests/client/session-browser-prefs.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/client/src/stores/hermes/profiles.ts packages/client/src/stores/hermes/chat.ts tests/client/profiles-store-sync.test.ts
git commit -m "feat: sync active profile changes across tabs"
```

---

## Task 5 — Add server-side profile session status feed

**Objective:** Expose runtime `working/approval/queue/abort` session status to all tabs for a profile, independent of which session they opened.

**Files:**

- Modify: `packages/server/src/services/hermes/run-chat/types.ts`
- Modify: `packages/server/src/services/hermes/run-chat/index.ts`
- Modify: `packages/server/src/services/hermes/run-chat/handle-bridge-run.ts`
- Modify: `packages/server/src/services/hermes/run-chat/handle-api-run.ts`
- Modify: `packages/server/src/services/hermes/run-chat/session-command.ts`
- Test: `tests/server/chat-run-status-feed.test.ts` (new, if existing Socket.IO tests allow) or extend existing run-chat tests.

**Step 1: Write failing server tests**

Minimum behavior tests:

1. `subscribe_status` joins `profile:${profile}:session-status`.
2. subscribing emits `session.status.snapshot` with working sessions for that profile.
3. `approval.requested` updates status snapshot/delta with pending approval.
4. `approval.resolved` clears pending approval.
5. `run.completed` clears `isWorking` when queue is empty.

If full Socket.IO integration is too heavy, unit-test pure helpers introduced in this task.

**Step 2: Verify RED**

Run:

```bash
npm test -- tests/server/chat-run-status-feed.test.ts
```

Expected: FAIL.

**Step 3: Implement status model helpers**

In `types.ts` or a new file:

```ts
export interface SessionRuntimeStatus {
  session_id: string
  profile: string
  isWorking: boolean
  isAborting?: boolean
  queueLength?: number
  pendingApproval?: SessionPendingApproval | null
  updatedAt: number
}
```

Extend `SessionState` with optional:

```ts
pendingApproval?: SessionPendingApproval | null
lastStatusUpdatedAt?: number
```

**Step 4: Implement profile room subscription**

In `ChatRunSocket.onConnection`:

```ts
socket.on('subscribe_status', ({ profile }) => {
  const resolvedProfile = ...validate access...
  socket.join(`profile:${resolvedProfile}:session-status`)
  socket.emit('session.status.snapshot', {
    profile: resolvedProfile,
    sessions: this.runtimeStatusSnapshot(resolvedProfile),
  })
})
```

**Step 5: Emit status updates**

Add helper:

```ts
private emitStatus(profile: string, sessionId: string, state: SessionState) {
  this.nsp.to(`profile:${profile}:session-status`).emit('session.status.updated', this.toRuntimeStatus(sessionId, state))
}
```

Call this helper whenever runtime state changes.

Important: status feed should not include message content. Keep it lightweight.

**Step 6: Verify GREEN**

Run:

```bash
npm test -- tests/server/chat-run-status-feed.test.ts tests/server/health-controller.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/server/src/services/hermes/run-chat tests/server/chat-run-status-feed.test.ts
git commit -m "feat: add chat session status feed"
```

---

## Task 6 — Add client API for session status feed

**Objective:** Wire profile-level status events into the Socket.IO client layer without disrupting per-session streaming handlers.

**Files:**

- Modify: `packages/client/src/api/hermes/chat.ts`
- Test: `tests/client/chat-status-sync.test.ts`

**Step 1: Write failing tests**

Test cases:

1. `subscribeSessionStatus(profile, handlers)` emits `subscribe_status`.
2. `session.status.snapshot` invokes snapshot handler.
3. `session.status.updated` invokes update handler.
4. reconnect/profile change does not duplicate listeners.

**Step 2: Verify RED**

Run:

```bash
npm test -- tests/client/chat-status-sync.test.ts
```

Expected: FAIL.

**Step 3: Implement API**

Add exports:

```ts
export interface SessionRuntimeStatus { ... }
export function subscribeSessionStatus(
  profile: string,
  handlers: {
    onSnapshot: (payload: { profile: string; sessions: SessionRuntimeStatus[] }) => void
    onUpdate: (status: SessionRuntimeStatus) => void
  },
): () => void
```

Implementation notes:

- Use `connectChatRun(profile)`.
- Add/remove socket listeners cleanly.
- Emit `subscribe_status` after listener registration.
- Preserve existing global session event handlers.

**Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/client/chat-status-sync.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/client/src/api/hermes/chat.ts tests/client/chat-status-sync.test.ts
git commit -m "feat: add client session status subscription"
```

---

## Task 7 — Apply runtime status feed in chat store

**Objective:** Make `working` and `approval` indicators update in every chat-list tab for the active profile.

**Files:**

- Modify: `packages/client/src/stores/hermes/chat.ts`
- Modify: `packages/client/src/views/hermes/ChatView.vue` if subscription should start only in chat view
- Test: `tests/client/chat-session-attention.test.ts`
- Test: `tests/client/chat-status-sync.test.ts`

**Step 1: Write failing tests**

Test cases:

1. status snapshot with `{ isWorking: true }` makes `sessionAttentionState(id)` return `working` without opening session.
2. status update with pendingApproval makes `sessionAttentionState(id)` return `approval`.
3. status update resolving approval falls back to working/unread/read.
4. status update completed clears working.
5. status from other profile is ignored.
6. active visible session receiving output remains read while runtime status updates still apply.

**Step 2: Verify RED**

Run:

```bash
npm test -- tests/client/chat-session-attention.test.ts tests/client/chat-status-sync.test.ts
```

Expected: FAIL.

**Step 3: Implement store state**

In `chat.ts`, add:

```ts
const runtimeStatuses = ref<Map<string, SessionRuntimeStatus>>(new Map())
```

Update `isSessionLive`:

```ts
return streamStates.value.has(sessionId)
  || serverWorking.value.has(sessionId)
  || runtimeStatuses.value.get(sessionId)?.isWorking === true
```

Update `hasPendingApproval`:

```ts
return pendingApprovals.value.has(sessionId)
  || Boolean(runtimeStatuses.value.get(sessionId)?.pendingApproval)
```

But ensure `activePendingApproval` still returns a full `PendingApproval` object for the active chat bar. Convert runtime pending approval to existing shape if needed.

**Step 4: Start/stop subscription**

Add action:

```ts
function startSessionStatusSync(profile?: string): () => void
```

This should:

- subscribe for current profile;
- apply snapshot/update;
- clear runtime statuses on profile change;
- return cleanup function.

Call from `ChatView.vue` after `profilesStore.fetchProfiles()` and before/after `loadRouteSession()`.

**Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/client/chat-session-attention.test.ts tests/client/chat-status-sync.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/client/src/stores/hermes/chat.ts packages/client/src/views/hermes/ChatView.vue tests/client/chat-session-attention.test.ts tests/client/chat-status-sync.test.ts
git commit -m "feat: sync chat runtime statuses across tabs"
```

---

## Task 8 — Add multi-tab E2E coverage

**Objective:** Prove the new foundation fixes the user-visible stale status problem.

**Files:**

- Modify: `tests/e2e/session-attention-states.spec.ts`
- Modify: `tests/e2e/chat-session-multitab.spec.ts`
- Optionally modify: `tests/e2e/fixtures.ts`

**Step 1: Add read/unread cross-tab E2E**

Scenario:

1. Open two pages in same browser context at `/chat` with same profile.
2. Seed unread for `session-unread-1`.
3. Assert both pages show unread indicator.
4. Click/open session in page A.
5. Assert page B clears unread indicator without reload.

**Step 2: Add runtime status cross-tab E2E**

If fixture socket mocking supports it:

1. Two pages on `/chat`.
2. Mock/emit `session.status.updated` with working status for session A.
3. Assert both pages show working indicator.
4. Emit approval status.
5. Assert both pages show approval indicator.
6. Emit resolved/completed.
7. Assert indicators clear/fallback.

If socket mocking is too expensive, add Playwright-level unit/integration coverage with mocked `socket.io-client` in Vitest and document E2E limitation.

**Step 3: Verify**

Run:

```bash
npm run test:e2e -- tests/e2e/session-attention-states.spec.ts tests/e2e/chat-session-multitab.spec.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add tests/e2e/session-attention-states.spec.ts tests/e2e/chat-session-multitab.spec.ts tests/e2e/fixtures.ts
git commit -m "test: cover cross-tab session attention sync"
```

---

## Task 9 — Final verification and review

**Objective:** Ensure the synchronization foundation does not regress existing realtime features.

Run targeted tests:

```bash
npm test -- \
  tests/client/browser-sync.test.ts \
  tests/client/chat-session-attention.test.ts \
  tests/client/chat-status-sync.test.ts \
  tests/client/session-browser-prefs.test.ts \
  tests/client/session-list-item.test.ts \
  tests/client/sidebar-search.test.ts
```

Run server tests:

```bash
npm test -- \
  tests/server/chat-run-status-feed.test.ts \
  tests/server/health-controller.test.ts
```

Run E2E:

```bash
npm run test:e2e -- \
  tests/e2e/session-attention-states.spec.ts \
  tests/e2e/chat-session-multitab.spec.ts \
  tests/e2e/native-navigation.spec.ts \
  tests/e2e/authenticated-shell.spec.ts
```

Build:

```bash
npm run build
```

Manual QA:

1. Open two browser windows on `/chat` under same profile.
2. Start a run in window A.
3. Confirm window B session list shows `working` without opening the session.
4. Trigger approval in window A.
5. Confirm window B shows `approval` without opening the session.
6. Resolve approval in window B.
7. Confirm window A clears approval.
8. Let run produce output in background.
9. Confirm unread appears in both windows.
10. Open/read in window A.
11. Confirm unread clears in window B.
12. Pin/unpin a session in window A.
13. Confirm window B updates pinned section.
14. Switch active profile in one window.
15. Confirm other window reloads profile-scoped prefs/statuses without changing its active route unexpectedly.
16. Confirm middle-click session links still open new tabs.
17. Confirm Kanban page still receives event stream updates.
18. Confirm Group Chat current room still streams messages.

Security/static scan:

```bash
git diff --cached | grep '^+' | grep -iE "(api_key|secret|password|token|passwd)\s*=\s*['\"][^'\"]{6,}['\"]" || true
git diff --cached | grep '^+' | grep -E "os\.system\(|subprocess.*shell=True|\beval\(|\bexec\(|pickle\.loads?\(|execute\(f\"|\.format\(.*SELECT|\.format\(.*INSERT" || true
```

Final review focus:

- Cross-tab local state does not loop indefinitely.
- Runtime status feed does not leak profile data across users/profiles.
- Runtime status payload contains no message content/secrets.
- Per-session streaming handlers still receive full events.
- Status feed remains lightweight under token streaming.
- Profile switch cleans old runtime state.

Commit if needed:

```bash
git status --short
git log --oneline --max-count=10
git commit -m "feat: add web ui state sync foundation"
```

---

## Risk Notes

### Risk: feedback loops between tabs

Mitigation:

- Every browser sync event includes `sourceId`.
- Consumers ignore events from their own `sourceId`.
- Only publish on actual state changes.

### Risk: status feed too noisy

Mitigation:

- Do not emit status updates for every token delta.
- Emit only lifecycle/status changes: start, queue, approval, abort, complete/fail.
- Keep payload tiny and content-free.

### Risk: profile data leak

Mitigation:

- Validate profile access in `subscribe_status` using the same auth/profile access checks as run/resume.
- Join only `profile:${profile}:session-status` for allowed profiles.
- Include profile in payload; client ignores mismatched profiles.

### Risk: stale approval after reconnect

Mitigation:

- Snapshot includes pendingApproval only from runtime `SessionState`.
- Approval is not persisted to localStorage.
- On profile status snapshot, replace runtime status map for that profile.

### Risk: tab-local route accidentally syncs

Mitigation:

- Do not broadcast `activeSessionId` or route changes.
- Keep URL route as tab-local source of truth.

### Risk: localStorage unavailable

Mitigation:

- browser sync utility catches storage errors.
- BroadcastChannel used when available.
- Stores still work in-memory in private/restricted environments.

---

## Future Enhancements

Not part of this foundation PR:

1. Server-side read receipts per user/profile/session.
2. Cross-device unread sync.
3. Browser notifications.
4. Unread counts.
5. Global shell notification center.
6. Room-list unread/status indicators for Group Chat.
7. A generalized store sync registry for every localStorage-backed preference.
8. Persisted runtime status history after server restart.
