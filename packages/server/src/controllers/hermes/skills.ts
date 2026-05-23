import { readdir, readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { createHash } from 'crypto'
import { homedir } from 'os'
import {
  readConfigYaml, updateConfigYaml,
  safeReadFile, extractDescription, listFilesRecursive, getHermesDir,
} from '../../services/config-helpers'
import { pinSkill } from '../../services/hermes/hermes-cli'
import { isPathWithin } from '../../services/hermes/hermes-path'
import { getSkillUsageStatsFromDb } from '../../db/hermes/sessions-db'

/** Read bundled manifest as a name→hash map from ~/.hermes/skills/.bundled_manifest */
function readBundledManifest(manifestContent: string | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!manifestContent) return map
  for (const line of manifestContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    if (idx === -1) continue
    const name = trimmed.slice(0, idx).trim()
    const hash = trimmed.slice(idx + 1).trim()
    if (name && hash) map.set(name, hash)
  }
  return map
}

/** Read hub-installed skill names from ~/.hermes/skills/.hub/lock.json */
function readHubInstalledNames(lockContent: string | null): Set<string> {
  if (!lockContent) return new Set()
  try {
    const data = JSON.parse(lockContent)
    if (data?.installed && typeof data.installed === 'object') {
      return new Set(Object.keys(data.installed))
    }
  } catch { /* ignore */ }
  return new Set()
}

/** Compute md5 hash of all files in a directory (mirrors Hermes _dir_hash), with in-memory cache */
const hashCache = new Map<string, { hash: string; mtime: number }>()
const HASH_CACHE_TTL = 60_000 // 1 minute

async function dirHash(directory: string): Promise<string> {
  const cached = hashCache.get(directory)
  if (cached && Date.now() - cached.mtime < HASH_CACHE_TTL) return cached.hash

  const hasher = createHash('md5')
  const files = await listFilesRecursive(directory, '')
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  for (const f of files) {
    hasher.update(f.path)
    const content = await readFile(join(directory, f.path))
    hasher.update(content)
  }
  const hash = hasher.digest('hex')
  hashCache.set(directory, { hash, mtime: Date.now() })
  return hash
}

/** Determine the source type of a skill */
function getSkillSource(
  dirName: string,
  bundledManifest: Map<string, string>,
  hubNames: Set<string>,
): 'builtin' | 'hub' | 'local' {
  if (bundledManifest.has(dirName)) return 'builtin'
  if (hubNames.has(dirName)) return 'hub'
  return 'local'
}

/** Read .usage.json as a name→stats map */
interface UsageStats { patch_count: number; use_count: number; view_count: number; pinned: boolean }
function readUsageStats(usageContent: string | null): Map<string, UsageStats> {
  const map = new Map<string, UsageStats>()
  if (!usageContent) return map
  try {
    const data = JSON.parse(usageContent)
    for (const [name, stats] of Object.entries(data)) {
      const s = stats as any
      map.set(name, { patch_count: s.patch_count ?? 0, use_count: s.use_count ?? 0, view_count: s.view_count ?? 0, pinned: !!s.pinned })
    }
  } catch { /* ignore */ }
  return map
}

async function findSkillDirByName(rootDir: string, skillName: string): Promise<string | null> {
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(rootDir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const entryPath = join(rootDir, entry.name)
    const skillMd = await safeReadFile(join(entryPath, 'SKILL.md'))
    if (skillMd !== null) {
      if (entry.name === skillName) return entryPath
      // This is another skill root. Do not search inside its references/scripts.
      continue
    }

    const found = await findSkillDirByName(entryPath, skillName)
    if (found) return found
  }

  return null
}

/**
 * Scan for skills at different directory depths.
 *
 * Supports both:
 *   - Three-level: skills/<category>/<skill-name>/SKILL.md  (category is a container)
 *   - Two-level:   skills/<skill-name>/SKILL.md            (flat skill under "misc" category)
 *
 * Categories are identified by having a DESCRIPTION.md at the category level
 * or by containing subdirectories with SKILL.md (three-level pattern).
 * Skills without a parent category (flat skills) are grouped under the "misc" category.
 */
async function scanSkillsDir(skillsDir: string, bundledManifest: Map<string, string>, hubNames: Set<string>, disabledList: string[], usageStats: Map<string, UsageStats>) {
  const allEntries = await readdir(skillsDir, { withFileTypes: true })
  const dirNames = allEntries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name)

  // Classify directories: categories vs. flat skills
  const categoryDirs: { name: string; description: string }[] = []
  const flatSkills: { name: string; skillMd: string; source: string }[] = []

  for (const dirName of dirNames) {
    const catDir = join(skillsDir, dirName)
    const hasDesc = await safeReadFile(join(catDir, 'DESCRIPTION.md'))
    const hasSkillMd = await safeReadFile(join(catDir, 'SKILL.md'))
    const subEntries = await readdir(catDir, { withFileTypes: true })
    const subDirs = subEntries.filter(se => se.isDirectory())

    // Priority: SKILL.md at top level → flat skill
    //           DESCRIPTION.md or subdirs (without SKILL.md) → category
    if (hasSkillMd) {
      // Flat skill: has SKILL.md at the top level (two-level pattern)
      // Could also have subdirectories (references/, scripts/, etc.)
      flatSkills.push({
        name: dirName,
        skillMd: hasSkillMd,
        source: getSkillSource(dirName, bundledManifest, hubNames),
      })
    } else if (!!hasDesc || subDirs.length > 0) {
      // True category: has DESCRIPTION.md or subdirs, but no SKILL.md at top level
      const catDescription = hasDesc ? hasDesc.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 100) : ''
      categoryDirs.push({ name: dirName, description: catDescription })
    }
  }

  // Build categories with their nested skills
  const categories: any[] = []

  for (const cat of categoryDirs) {
    const catDir = join(skillsDir, cat.name)
    const subEntries = await readdir(catDir, { withFileTypes: true })
    const skills: any[] = []
    // Recursively collect skills from subdirectories (supports nested sub-categories)
    async function collectSkills(dir: string): Promise<any[]> {
      const entries = await readdir(dir, { withFileTypes: true })
      const results: any[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const entryPath = join(dir, entry.name)
        const skillMd = await safeReadFile(join(entryPath, 'SKILL.md'))
        if (skillMd) {
          const source = getSkillSource(entry.name, bundledManifest, hubNames)
          let modified = false
          if (source === 'builtin') {
            const manifestHash = bundledManifest.get(entry.name)
            if (manifestHash) {
              const currentHash = await dirHash(entryPath)
              modified = currentHash !== manifestHash
            }
          }
          const usage = usageStats.get(entry.name)
          results.push({
            name: entry.name,
            description: extractDescription(skillMd),
            enabled: !disabledList.includes(entry.name),
            source,
            modified: modified || undefined,
            patchCount: usage?.patch_count,
            useCount: usage?.use_count,
            viewCount: usage?.view_count,
            pinned: usage?.pinned || undefined,
          })
        } else {
          // No SKILL.md — might be a sub-category container, recurse deeper
          const subResults = await collectSkills(entryPath)
          results.push(...subResults)
        }
      }
      return results
    }
    skills.push(...await collectSkills(catDir))
    if (skills.length > 0) {
      categories.push({ name: cat.name, description: cat.description, skills })
    }
  }

  // Group flat skills into a "misc" (雜項) category
  if (flatSkills.length > 0) {
    const miscSkills: any[] = []
    for (const fs of flatSkills) {
      const usage = usageStats.get(fs.name)
      miscSkills.push({
        name: fs.name,
        description: extractDescription(fs.skillMd),
        enabled: !disabledList.includes(fs.name),
        source: fs.source,
        modified: undefined,
        patchCount: usage?.patch_count,
        useCount: usage?.use_count,
        viewCount: usage?.view_count,
        pinned: usage?.pinned || undefined,
      })
    }
    miscSkills.sort((a: any, b: any) => a.name.localeCompare(b.name))
    categories.push({
      name: 'misc',
      description: '雜項',
      skills: miscSkills,
    })
  }

  categories.sort((a, b) => a.name.localeCompare(b.name))
  for (const cat of categories) { cat.skills.sort((a: any, b: any) => a.name.localeCompare(b.name)) }
  return categories
}

/** Get all skill directories: primary + external_dirs from config. */
async function getAllSkillsDirs(): Promise<string[]> {
  const dirs = [join(getHermesDir(), 'skills')]
  try {
    const config = await readConfigYaml()
    const externalDirs: string[] = config.skills?.external_dirs || []
    for (const ed of externalDirs) {
      const resolved = ed.startsWith('~') ? join(homedir(), ed.slice(1)) : ed
      dirs.push(resolved)
    }
  } catch { /* ignore config read errors */ }
  return dirs
}

/** Scan a single skills base directory, returning categories with skills. */
async function scanSkillsDirLegacy(baseDir: string, disabledList: string[]): Promise<{ name: string; description: string; skills: { name: string; description: string; enabled: boolean }[] }[]> {
  const categories: { name: string; description: string; skills: { name: string; description: string; enabled: boolean }[] }[] = []
  let entries
  try {
    entries = await readdir(baseDir, { withFileTypes: true })
  } catch {
    return categories
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const catDir = join(baseDir, entry.name)
    const catDesc = await safeReadFile(join(catDir, 'DESCRIPTION.md'))
    const catDescription = catDesc ? catDesc.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 100) : ''
    let skillEntries
    try {
      skillEntries = await readdir(catDir, { withFileTypes: true })
    } catch {
      continue
    }
    const skills: { name: string; description: string; enabled: boolean }[] = []
    for (const se of skillEntries) {
      if (!se.isDirectory()) continue
      const skillMd = await safeReadFile(join(catDir, se.name, 'SKILL.md'))
      if (skillMd) {
        skills.push({ name: se.name, description: extractDescription(skillMd), enabled: !disabledList.includes(se.name) })
      }
    }
    if (skills.length > 0) {
      categories.push({ name: entry.name, description: catDescription, skills })
    }
  }
  return categories
}

/** Merge categories from multiple sources. Later sources' skills are appended if not duplicate. */
function mergeCategories(existing: any[], incoming: any[]): any[] {
  const merged = [...existing]
  for (const cat of incoming) {
    const existingCat = merged.find((c: any) => c.name === cat.name)
    if (existingCat) {
      for (const skill of cat.skills) {
        if (!existingCat.skills.find((s: any) => s.name === skill.name)) {
          existingCat.skills.push(skill)
        }
      }
    } else {
      merged.push(cat)
    }
  }
  return merged
}

export async function list(ctx: any) {
  try {
    const config = await readConfigYaml()
    const disabledList: string[] = config.skills?.disabled || []

    // Read provenance sources for the primary skills directory.
    const bundledManifest = readBundledManifest(await safeReadFile(join(skillsDir, '.bundled_manifest')))
    const hubNames = readHubInstalledNames(await safeReadFile(join(skillsDir, '.hub', 'lock.json')))
    const usageStats = readUsageStats(await safeReadFile(join(skillsDir, '.usage.json')))

    // Scan the primary skills directory, then merge any external skill roots.
    let categories = await scanSkillsDir(skillsDir, bundledManifest, hubNames, disabledList, usageStats)
    const allDirs = await getAllSkillsDirs()
    for (const dir of allDirs) {
      if (resolve(dir) === resolve(skillsDir)) continue
      const scanned = await scanSkillsDir(dir, bundledManifest, hubNames, disabledList, usageStats)
      categories = mergeCategories(categories, scanned)
    }

    // Read archived skills from .archive/
    const archived: any[] = []
    const archiveDir = join(skillsDir, '.archive')
    const archiveEntries = await readdir(archiveDir, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[])
    for (const entry of archiveEntries) {
      if (!entry.isDirectory()) continue
      const skillMd = await safeReadFile(join(archiveDir, entry.name, 'SKILL.md'))
      if (skillMd) {
        const usage = usageStats.get(entry.name)
        archived.push({
          name: entry.name,
          description: extractDescription(skillMd),
          source: getSkillSource(entry.name, bundledManifest, hubNames),
          patchCount: usage?.patch_count,
          useCount: usage?.use_count,
          viewCount: usage?.view_count,
          pinned: usage?.pinned || undefined,
        })
      }
    }
    archived.sort((a: any, b: any) => a.name.localeCompare(b.name))

    ctx.body = { categories, archived }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: `Failed to read skills directory: ${err.message}` }
  }
}

export async function usageStats(ctx: any) {
  const rawDays = parseInt(String(ctx.query?.days ?? '7'), 10)
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : 7

  try {
    ctx.body = await getSkillUsageStatsFromDb(days)
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: `Failed to read skill usage stats: ${err.message}` }
  }
}

export async function toggle(ctx: any) {
  const { name, enabled } = ctx.request.body as { name?: string; enabled?: boolean }
  if (!name || typeof enabled !== 'boolean') {
    ctx.status = 400
    ctx.body = { error: 'Missing name or enabled flag' }
    return
  }
  try {
    await updateConfigYaml((config) => {
      if (!config.skills) config.skills = {}
      if (!Array.isArray(config.skills.disabled)) config.skills.disabled = []
      const disabled = config.skills.disabled as string[]
      const idx = disabled.indexOf(name)
      if (enabled) { if (idx !== -1) disabled.splice(idx, 1) }
      else { if (idx === -1) disabled.push(name) }
      return config
    })
    ctx.body = { success: true }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
}

export async function listFiles(ctx: any) {
  const { category, skill } = ctx.params
  const allDirs = await getAllSkillsDirs()
  for (const dir of allDirs) {
    const skillDir = category === 'misc'
      ? join(dir, 'skills', skill)
      : join(dir, category, skill)
    try {
      await readdir(skillDir) // quick existence check
      const allFiles = await listFilesRecursive(skillDir, '')
      const files = allFiles.filter((f: any) => f.path !== 'SKILL.md')
      ctx.body = { files }
      return
    } catch { /* try next dir */ }
  }
  ctx.status = 404
  ctx.body = { error: 'Skill not found' }
}

export async function readFile_(ctx: any) {
  const filePath = (ctx.params as any).path
  const allDirs = await getAllSkillsDirs()
  for (const dir of allDirs) {
    // Handle 'misc' category: real skill dir is skills/<skill>, not skills/misc/<skill>
    const normalizedPath = filePath.startsWith('misc/') ? filePath.slice(5) : filePath
    const fullPath = resolve(join(dir, 'skills', normalizedPath))
    if (!isPathWithin(fullPath, join(dir, 'skills'))) continue
    const content = await safeReadFile(fullPath)
    if (content !== null) {
      ctx.body = { content }
      return
    }
  }
  ctx.status = 404
  ctx.body = { error: 'File not found' }
}

export async function pin_(ctx: any) {
  const { name, pinned } = ctx.request.body as { name?: string; pinned?: boolean }
  if (!name || typeof pinned !== 'boolean') {
    ctx.status = 400
    ctx.body = { error: 'Missing name or pinned flag' }
    return
  }
  try {
    await pinSkill(name, pinned)
    ctx.body = { success: true }
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message }
  }
}
