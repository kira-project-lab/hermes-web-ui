import { callSummarizer } from '../../lib/context-compressor'
import { readConfigYamlForProfile } from '../config-helpers'
import { getActiveProfileName } from './hermes-profile'
import { getSessionDetail, updateSession } from '../../db/hermes/session-store'
import type { Server } from 'socket.io'
import { emitSessionListChanged } from './run-chat/status-feed'

export interface SessionTitleGenerationConfig {
  enabled?: boolean
  model?: string | null
  provider?: string | null
  prompt?: string | null
}

export interface SessionTitleGenerationResult {
  generated: boolean
  title: string | null
  reason?: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_WORDS = 4
const DEFAULT_MAX_CHARS = 48

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripDecorators(value: string): string {
  return value
    .replace(/^[-*•]+\s*/, '')
    .replace(/^title\s*[:\-]\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

function clampTitle(value: string): string {
  const clean = normalizeSpace(stripDecorators(value))
  if (!clean) return ''
  const wordLimited = clean.split(' ').slice(0, DEFAULT_MAX_WORDS).join(' ')
  return wordLimited.length > DEFAULT_MAX_CHARS ? wordLimited.slice(0, DEFAULT_MAX_CHARS).trim() : wordLimited
}

function buildSeed(messages: Array<{ role: string; content: string }>): string {
  const user = messages.find(m => m.role === 'user' && String(m.content || '').trim())
  const assistant = messages.find(m => m.role === 'assistant' && String(m.content || '').trim())

  const lines = [
    'Generate a short, distinctive session title.',
    'Return only the title, with no quotes, bullets, numbering, or explanation.',
    'Prefer 1-4 words and keep it memorable.',
  ]

  if (user?.content) lines.push(`User message: ${normalizeSpace(String(user.content))}`)
  if (assistant?.content) lines.push(`Assistant reply: ${normalizeSpace(String(assistant.content))}`)

  return lines.join('\n\n')
}

function heuristicTitle(messages: Array<{ role: string; content: string }>): string {
  const user = messages.find(m => m.role === 'user' && String(m.content || '').trim())?.content ?? ''
  const assistant = messages.find(m => m.role === 'assistant' && String(m.content || '').trim())?.content ?? ''
  const source = normalizeSpace(String(user || assistant || ''))
  if (!source) return 'New session'

  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'you', 'your', 'our', 'в', 'на', 'и', 'для', 'что', 'это'])
  const words = source
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !stopWords.has(word))
    .slice(0, DEFAULT_MAX_WORDS)
  if (!words.length) return clampTitle(source) || 'New session'
  return clampTitle(words.join(' ')) || 'New session'
}

async function readGenerationConfig(profile: string): Promise<SessionTitleGenerationConfig | null> {
  try {
    const config = await readConfigYamlForProfile(profile)
    const raw = config?.session_title_generation
    if (!raw || typeof raw !== 'object') return null
    return raw as SessionTitleGenerationConfig
  } catch {
    return null
  }
}

function shouldSkipExistingTitle(titleSource: unknown): boolean {
  const source = String(titleSource || '').trim().toLowerCase()
  return source === 'manual' || source === 'generated' || source === 'auto'
}

export async function maybeGenerateSessionTitle(
  sessionId: string,
  profile = getActiveProfileName(),
  nsp?: ReturnType<Server['of']>,
): Promise<SessionTitleGenerationResult> {
  const config = await readGenerationConfig(profile)
  if (!config?.enabled) return { generated: false, title: null, reason: 'disabled' }

  const detail = getSessionDetail(sessionId)
  if (!detail) return { generated: false, title: null, reason: 'session-not-found' }
  if (shouldSkipExistingTitle((detail as any).title_source)) return { generated: false, title: detail.title, reason: 'already-titled' }

  const seedMessages = detail.messages
    .filter(msg => msg && (msg.role === 'user' || msg.role === 'assistant') && String(msg.content || '').trim())
    .slice(0, 6)
    .map(msg => ({ role: msg.role, content: String(msg.content || '') }))

  if (seedMessages.length < 2) {
    return { generated: false, title: detail.title ?? null, reason: 'insufficient-context' }
  }

  const prompt = [
    config.prompt ? `Instruction: ${normalizeSpace(String(config.prompt))}` : null,
    buildSeed(seedMessages),
  ].filter(Boolean).join('\n\n')

  let title = ''
  try {
    title = clampTitle(await callSummarizer('', undefined, prompt, [], DEFAULT_TIMEOUT_MS, undefined, {
      profile,
      model: config.model || null,
      provider: config.provider || null,
    }))
  } catch {
    title = ''
  }

  if (!title) title = heuristicTitle(seedMessages)
  if (!title) return { generated: false, title: null, reason: 'empty-title' }

  updateSession(sessionId, {
    title,
    title_source: 'generated',
    title_generated_at: Math.floor(Date.now() / 1000),
  })

  if (nsp) {
    emitSessionListChanged(nsp, profile, 'updated', sessionId)
  }

  return { generated: true, title }
}
