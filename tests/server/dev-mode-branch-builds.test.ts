import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as ctrl from '../../packages/server/src/controllers/hermes/dev-mode-branch-builds'

const isDevModeEnabled = vi.fn()
const listRepositoryBranches = vi.fn()
const startBranchBuild = vi.fn()
const resetPreviewTarget = vi.fn()
const getActiveProfileName = vi.fn()

vi.mock('../../packages/server/src/services/hermes/dev-mode-branch-builds', () => ({
  isDevModeEnabled: (...args: any[]) => isDevModeEnabled(...args),
  listRepositoryBranches: (...args: any[]) => listRepositoryBranches(...args),
  startBranchBuild: (...args: any[]) => startBranchBuild(...args),
  resetPreviewTarget: (...args: any[]) => resetPreviewTarget(...args),
}))

vi.mock('../../packages/server/src/services/hermes/hermes-profile', () => ({
  getActiveProfileName: (...args: any[]) => getActiveProfileName(...args),
}))

function makeCtx(state: any = {}) {
  return {
    state,
    request: { body: {} },
    status: 0,
    body: undefined as any,
  }
}

beforeEach(() => {
  isDevModeEnabled.mockReset()
  listRepositoryBranches.mockReset()
  startBranchBuild.mockReset()
  resetPreviewTarget.mockReset()
  getActiveProfileName.mockReset()
  getActiveProfileName.mockReturnValue('default')
})

describe('dev-mode branch build controller', () => {
  it('rejects requests when dev mode is disabled', async () => {
    isDevModeEnabled.mockResolvedValue(false)
    const ctx = makeCtx({ profile: { name: 'profile-a' }, user: { role: 'super_admin' } })

    await ctrl.listBranches(ctx)

    expect(ctx.status).toBe(403)
    expect(ctx.body).toEqual({ error: 'Dev Mode is disabled' })
  })

  it('lists branches when dev mode is enabled', async () => {
    isDevModeEnabled.mockResolvedValue(true)
    listRepositoryBranches.mockResolvedValue(['fork-review/a', 'fork-review/b'])
    const ctx = makeCtx({ profile: { name: 'profile-a' }, user: { role: 'super_admin' } })

    await ctrl.listBranches(ctx)

    expect(listRepositoryBranches).toHaveBeenCalledTimes(1)
    expect(ctx.body).toEqual({ branches: ['fork-review/a', 'fork-review/b'] })
  })

  it('validates branch input before building', async () => {
    const ctx = makeCtx({ profile: { name: 'profile-a' }, user: { role: 'super_admin' } })

    await ctrl.buildBranch(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: 'Missing branch' })
    expect(startBranchBuild).not.toHaveBeenCalled()
  })

  it('builds the requested branch and trims whitespace', async () => {
    isDevModeEnabled.mockResolvedValue(true)
    startBranchBuild.mockResolvedValue({ state: { status: 'success' }, worktreePath: '/tmp/worktree' })
    const ctx = makeCtx({ profile: { name: 'profile-a' }, user: { role: 'super_admin' } })
    ctx.request.body = { branch: '  feature/test  ' }

    await ctrl.buildBranch(ctx)

    expect(startBranchBuild).toHaveBeenCalledWith('profile-a', 'feature/test')
    expect(ctx.body).toEqual({ state: { status: 'success' }, worktreePath: '/tmp/worktree' })
  })

  it('resets the preview target when enabled', async () => {
    isDevModeEnabled.mockResolvedValue(true)
    resetPreviewTarget.mockResolvedValue({ status: 'success' })
    const ctx = makeCtx({ profile: { name: 'profile-a' }, user: { role: 'super_admin' } })

    await ctrl.resetBranchPreview(ctx)

    expect(resetPreviewTarget).toHaveBeenCalledWith('profile-a')
    expect(ctx.body).toEqual({ status: 'success' })
  })
})
