import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import { i18n } from './i18n'
import App from './App.vue'
import './styles/global.scss'
import 'katex/dist/katex.min.css'

function cleanLegacyHermesPath(pathname: string): string {
  if (!pathname.startsWith('/hermes/')) return pathname
  return pathname.slice('/hermes'.length) || '/session/new'
}

function migrateLegacyHashRoutes(): string | null {
  const { hash, href, pathname } = window.location

  if (!hash.startsWith('#/')) {
    if (pathname.startsWith('/hermes/')) {
      const nextUrl = new URL(href)
      nextUrl.pathname = cleanLegacyHermesPath(pathname)
      window.history.replaceState(null, '', nextUrl)
    }
    return null
  }

  const legacyPath = hash.slice(1)
  const [legacyRoute, legacyQuery = ''] = legacyPath.split('?')
  const legacyParams = new URLSearchParams(legacyQuery)
  const legacyToken = legacyParams.get('token')

  const nextUrl = new URL(href)
  const pathDeepLink = pathname.match(/^\/hermes\/(session\/[^/?#]+|history\/session\/[^/?#]+|group-chat\/room\/[^/?#]+)/)

  if (pathDeepLink) {
    // Preserve resource deep links from odd legacy URLs like
    // /hermes/session/<id>#/hermes/chat instead of letting the hash route
    // collapse the link back to the generic session page.
    nextUrl.pathname = cleanLegacyHermesPath(pathname)
  } else if (legacyRoute.startsWith('/hermes/')) {
    nextUrl.pathname = cleanLegacyHermesPath(legacyRoute)
  } else {
    return legacyToken
  }

  nextUrl.search = nextUrl.search || ''
  nextUrl.hash = ''

  if (legacyToken && !nextUrl.searchParams.has('token')) {
    nextUrl.searchParams.set('token', legacyToken)
  }

  window.history.replaceState(null, '', nextUrl)
  return legacyToken
}

const legacyHashToken = migrateLegacyHashRoutes()

// Apply theme classes before mount to prevent FOUC (Flash of Unstyled Content)
const savedBrightness = localStorage.getItem('hermes_brightness') || 'system'
const savedStyle = localStorage.getItem('hermes_style') || 'ink'

// Resolve dark mode
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const isDark = savedBrightness === 'dark' || (savedBrightness === 'system' && prefersDark)

// Resolve style
const isComic = savedStyle === 'comic'

// Apply classes to prevent FOUC
if (isDark) {
  document.documentElement.classList.add('dark')
}
if (isComic) {
  document.documentElement.classList.add('comic')
}

// Read token from URL BEFORE router initializes
const urlParams = new URLSearchParams(window.location.search)
const urlToken = urlParams.get('token') || legacyHashToken
if (urlToken) {
  ;(window as any).__LOGIN_TOKEN__ = urlToken
}

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.use(router)
app.mount('#app')
