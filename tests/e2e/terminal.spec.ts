import { expect, test } from '@playwright/test'
import { authenticate, mockHermesApi, mockTerminalWebSocket, TEST_ACCESS_KEY } from './fixtures'

test('opens terminal websocket session and forwards user input', async ({ page }) => {
  await authenticate(page, TEST_ACCESS_KEY, 'research')
  const api = await mockHermesApi(page)
  await mockTerminalWebSocket(page)

  await page.goto('/#/hermes/terminal')

  await expect(page.locator('.session-list-title').first()).toBeVisible()
  await expect(page.locator('.session-item-title', { hasText: 'zsh #1' })).toBeVisible()
  const terminalState = await page.waitForFunction(() => {
    const state = (window as any).__PW_TERMINAL_WS__
    return state?.sockets?.length
      ? {
          url: state.latest.url,
          sent: state.sent,
        }
      : null
  })
  const initialState = await terminalState.jsonValue() as any
  const terminalUrl = new URL(initialState.url)
  expect(terminalUrl.pathname).toBe('/api/hermes/terminal')
  expect(terminalUrl.searchParams.get('token')).toBe(TEST_ACCESS_KEY)

  await page.locator('.terminal-header .header-actions button').last().click()
  await expect(page.locator('.session-item-title', { hasText: 'bash #2' })).toBeVisible()

  const terminalSessions = page.locator('.session-item').filter({ hasText: 'zsh #1' }).first()
  const activeSessionTitle = page.locator('.session-item.active .session-item-title').first()
  const activeBefore = await activeSessionTitle.textContent()
  await expect(terminalSessions.locator('.session-item-delete')).toBeVisible()
  await terminalSessions.hover()
  await expect(terminalSessions.locator('.session-item-delete')).toBeVisible()
  await terminalSessions.focus()
  await expect(terminalSessions.locator('.session-item-delete')).toBeVisible()
  await terminalSessions.locator('.session-item-delete').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.session-item.active .session-item-title').first()).toHaveText(activeBefore || '')
  await terminalSessions.locator('.session-item-delete').focus()
  await page.keyboard.press('Space')
  await expect(page.locator('.session-item.active .session-item-title').first()).toHaveText(activeBefore || '')

  await page.locator('.terminal-xterm').click()
  await page.keyboard.type('pwd')
  await page.keyboard.press('Enter')

  await expect.poll(async () => page.evaluate(() => {
    const state = (window as any).__PW_TERMINAL_WS__
    return state.sent
      .map((item: any) => item.data)
      .filter((data: string) => !data.startsWith('{'))
      .join('')
  })).toContain('pwd')

  await expect.poll(async () => page.evaluate(() => {
    const state = (window as any).__PW_TERMINAL_WS__
    return state.sent
      .map((item: any) => item.data)
      .filter((data: string) => data.startsWith('{'))
      .map((data: string) => JSON.parse(data))
      .some((message: any) => message.type === 'resize' && message.cols > 0 && message.rows > 0)
  })).toBe(true)

  const finalState = await page.evaluate(() => (window as any).__PW_TERMINAL_WS__)
  const controlMessages = finalState.sent
    .map((item: any) => item.data)
    .filter((data: string) => data.startsWith('{'))
    .map((data: string) => JSON.parse(data))

  expect(controlMessages.some((message: any) => message.type === 'create')).toBe(true)
  expect(api.unexpectedRequests).toEqual([])
})
