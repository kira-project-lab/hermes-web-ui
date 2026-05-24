import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readConfigYamlForProfileMock = vi.fn()
const getSessionDetailMock = vi.fn()
const updateSessionMock = vi.fn()
const callSummarizerMock = vi.fn()

vi.doMock('../../packages/server/src/services/config-helpers', () => ({
  readConfigYamlForProfile: readConfigYamlForProfileMock,
}))

vi.doMock('../../packages/server/src/db/hermes/session-store', () => ({
  getSessionDetail: getSessionDetailMock,
  updateSession: updateSessionMock,
}))

vi.doMock('../../packages/server/src/lib/context-compressor', () => ({
  callSummarizer: callSummarizerMock,
}))

describe('session title generation service', () => {
  beforeEach(() => {
    vi.resetModules()
    readConfigYamlForProfileMock.mockReset()
    getSessionDetailMock.mockReset()
    updateSessionMock.mockReset()
    callSummarizerMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('generates a title and stores generated metadata when enabled', async () => {
    readConfigYamlForProfileMock.mockResolvedValue({
      session_title_generation: {
        enabled: true,
        model: 'test-model',
        provider: 'test-provider',
        prompt: 'Be concise and specific.',
      },
    })

    getSessionDetailMock.mockReturnValue({
      title: 'Preview title',
      title_source: 'fallback',
      messages: [
        { role: 'user', content: 'How do I deploy the web UI?' },
        { role: 'assistant', content: 'Use the build script and restart the service.' },
      ],
    })

    callSummarizerMock.mockResolvedValue('Deploy web UI')

    const { maybeGenerateSessionTitle } = await import('../../packages/server/src/services/hermes/session-title-generator')
    const result = await maybeGenerateSessionTitle('session-1', 'default')

    expect(result).toEqual({ generated: true, title: 'Deploy web UI' })
    expect(callSummarizerMock).toHaveBeenCalledTimes(1)
    expect(updateSessionMock).toHaveBeenCalledWith('session-1', expect.objectContaining({
      title: 'Deploy web UI',
      title_source: 'generated',
      title_generated_at: expect.any(Number),
    }))
  })

  it('skips manual titles without calling the generator', async () => {
    readConfigYamlForProfileMock.mockResolvedValue({
      session_title_generation: {
        enabled: true,
      },
    })

    getSessionDetailMock.mockReturnValue({
      title: 'Manual title',
      title_source: 'manual',
      messages: [
        { role: 'user', content: 'What is the answer?' },
        { role: 'assistant', content: 'The answer is 42.' },
      ],
    })

    const { maybeGenerateSessionTitle } = await import('../../packages/server/src/services/hermes/session-title-generator')
    const result = await maybeGenerateSessionTitle('session-2', 'default')

    expect(result.generated).toBe(false)
    expect(result.reason).toBe('already-titled')
    expect(callSummarizerMock).not.toHaveBeenCalled()
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  it('emits a session list refresh when a title is generated and a namespace is provided', async () => {
    readConfigYamlForProfileMock.mockResolvedValue({
      session_title_generation: { enabled: true },
    })
    getSessionDetailMock.mockReturnValue({
      id: 'session-3',
      title: null,
      title_source: 'fallback',
      messages: [
        { role: 'user', content: 'Build title refresh' },
        { role: 'assistant', content: 'Sure' },
      ],
    })
    callSummarizerMock.mockResolvedValue('Refresh live title')

    const emitMock = vi.fn()
    const nsp = { to: vi.fn(() => ({ emit: emitMock })) } as any
    const { maybeGenerateSessionTitle } = await import('../../packages/server/src/services/hermes/session-title-generator')
    const result = await maybeGenerateSessionTitle('session-3', 'default', nsp)

    expect(result.generated).toBe(true)
    expect(nsp.to).toHaveBeenCalledWith('profile:default:session-status')
    expect(emitMock).toHaveBeenCalledWith('session.list.changed', expect.objectContaining({
      profile: 'default',
      reason: 'updated',
      session_id: 'session-3',
    }))
  })
})
