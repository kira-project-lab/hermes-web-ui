import { getActiveProfileName } from '../../services/hermes/hermes-profile'
import { getBranchBuildSummary, isDevModeEnabled, listRepositoryBranches, resetPreviewTarget, startBranchBuild } from '../../services/hermes/dev-mode-branch-builds'

function requestedProfile(ctx: any): string {
  return ctx.state?.profile?.name || getActiveProfileName() || 'default'
}

async function requireDevMode(ctx: any): Promise<string | null> {
  const profile = requestedProfile(ctx)
  if (!await isDevModeEnabled(profile)) {
    ctx.status = 403
    ctx.body = { error: 'Dev Mode is disabled' }
    return null
  }
  return profile
}

export async function listBranches(ctx: any) {
  try {
    const profile = await requireDevMode(ctx)
    if (!profile) return
    ctx.body = { branches: await listRepositoryBranches() }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err?.message || 'Failed to list branches' }
  }
}

export async function getStatus(ctx: any) {
  try {
    const profile = await requireDevMode(ctx)
    if (!profile) return
    ctx.body = await getBranchBuildSummary(profile)
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err?.message || 'Failed to read branch build status' }
  }
}

export async function buildBranch(ctx: any) {
  const { branch } = ctx.request.body as { branch?: string }
  if (!branch || !branch.trim()) {
    ctx.status = 400
    ctx.body = { error: 'Missing branch' }
    return
  }

  try {
    const profile = await requireDevMode(ctx)
    if (!profile) return
    ctx.body = await startBranchBuild(profile, branch.trim())
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err?.message || 'Branch build failed' }
  }
}

export async function resetBranchPreview(ctx: any) {
  try {
    const profile = await requireDevMode(ctx)
    if (!profile) return
    ctx.body = await resetPreviewTarget(profile)
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err?.message || 'Failed to reset preview target' }
  }
}
