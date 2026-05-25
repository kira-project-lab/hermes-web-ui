import { createRouter, createWebHistory, type RouteLocationRaw } from 'vue-router'
import { hasApiKey, isStoredSuperAdmin } from '@/api/client'

const routeMap = [
  { path: '/session/new', name: 'hermes.sessionNew', component: () => import('@/views/hermes/ChatView.vue') },
  { path: '/session/:sessionId', name: 'hermes.session', component: () => import('@/views/hermes/ChatView.vue') },
  { path: '/chat', name: 'hermes.chat', redirect: { name: 'hermes.sessionNew' } },
  { path: '/history', name: 'hermes.history', component: () => import('@/views/hermes/HistoryView.vue') },
  { path: '/history/session/:sessionId', name: 'hermes.historySession', component: () => import('@/views/hermes/HistoryView.vue') },
  { path: '/jobs', name: 'hermes.jobs', component: () => import('@/views/hermes/JobsView.vue') },
  { path: '/kanban', name: 'hermes.kanban', component: () => import('@/views/hermes/KanbanView.vue') },
  { path: '/models', name: 'hermes.models', component: () => import('@/views/hermes/ModelsView.vue') },
  { path: '/profiles', name: 'hermes.profiles', component: () => import('@/views/hermes/ProfilesView.vue'), meta: { requiresSuperAdmin: true } },
  { path: '/logs', name: 'hermes.logs', component: () => import('@/views/hermes/LogsView.vue') },
  { path: '/usage', name: 'hermes.usage', component: () => import('@/views/hermes/UsageView.vue') },
  { path: '/performance', name: 'hermes.performance', component: () => import('@/views/hermes/PerformanceView.vue'), meta: { requiresSuperAdmin: true } },
  { path: '/skills-usage', name: 'hermes.skillsUsage', component: () => import('@/views/hermes/SkillsUsageView.vue') },
  { path: '/skills', name: 'hermes.skills', component: () => import('@/views/hermes/SkillsView.vue') },
  { path: '/plugins', name: 'hermes.plugins', component: () => import('@/views/hermes/PluginsView.vue') },
  { path: '/memory', name: 'hermes.memory', component: () => import('@/views/hermes/MemoryView.vue') },
  { path: '/settings', name: 'hermes.settings', component: () => import('@/views/hermes/SettingsView.vue') },
  { path: '/channels', name: 'hermes.channels', component: () => import('@/views/hermes/ChannelsView.vue') },
  { path: '/terminal', name: 'hermes.terminal', component: () => import('@/views/hermes/TerminalView.vue') },
  { path: '/group-chat', name: 'hermes.groupChat', component: () => import('@/views/hermes/GroupChatView.vue') },
  { path: '/group-chat/room/:roomId', name: 'hermes.groupChatRoom', component: () => import('@/views/hermes/GroupChatView.vue') },
  { path: '/files', name: 'hermes.files', component: () => import('@/views/hermes/FilesView.vue') },
]

function cleanLegacyHermesPath(pathMatch: string | string[] | undefined): string {
  const segments = Array.isArray(pathMatch)
    ? pathMatch
    : typeof pathMatch === 'string' && pathMatch
      ? [pathMatch]
      : []
  return `/${segments.filter(Boolean).join('/') || 'chat'}`
}

function loginRedirectTarget(raw: unknown): RouteLocationRaw {
  const redirect = Array.isArray(raw) ? raw[0] : raw
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }
  return { name: 'hermes.sessionNew' }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    ...routeMap,
    {
      path: '/hermes/:pathMatch(.*)*',
      redirect: to => ({
        path: cleanLegacyHermesPath(to.params.pathMatch as string | string[] | undefined),
        query: to.query,
        hash: typeof to.hash === 'string' && to.hash.startsWith('#/hermes/') ? '' : to.hash,
      }),
    },
  ],
})

router.beforeEach((to, _from, next) => {
  if (to.meta.public) {
    if (to.name === 'login' && hasApiKey()) {
      next(loginRedirectTarget(to.query.redirect))
      return
    }
    next()
    return
  }

  if (!hasApiKey()) {
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  if (to.meta.requiresSuperAdmin && !isStoredSuperAdmin()) {
    next({ name: 'hermes.sessionNew' })
    return
  }

  next()
})

export default router
