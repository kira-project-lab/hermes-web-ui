// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive } from 'vue'

const authState = vi.hoisted(() => ({ isSuperAdmin: true }))
const fetchBranchBuildBranches = vi.hoisted(() => vi.fn())
const fetchBranchBuildStatus = vi.hoisted(() => vi.fn())
const buildBranchPreview = vi.hoisted(() => vi.fn())
const resetBranchPreview = vi.hoisted(() => vi.fn())
const useMessageMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))

const settingsStore = reactive({
  dev: {
    enabled: false,
    review_base: 'fork-review/review-base',
    preview_branch: '',
  },
  saveSection: vi.fn(async (_section: string, values: Record<string, any>) => {
    settingsStore.dev = { ...settingsStore.dev, ...values }
  }),
  updateLocal: vi.fn((section: string, values: Record<string, any>) => {
    if (section === 'dev') {
      settingsStore.dev = { ...settingsStore.dev, ...values }
    }
  }),
})

vi.mock('@/api/client', () => ({
  isStoredSuperAdmin: () => authState.isSuperAdmin,
}))

vi.mock('@/api/hermes/dev-mode-branch-builds', () => ({
  fetchBranchBuildBranches: (...args: any[]) => fetchBranchBuildBranches(...args),
  fetchBranchBuildStatus: (...args: any[]) => fetchBranchBuildStatus(...args),
  buildBranchPreview: (...args: any[]) => buildBranchPreview(...args),
  resetBranchPreview: (...args: any[]) => resetBranchPreview(...args),
}))

vi.mock('@/stores/hermes/settings', () => ({
  useSettingsStore: () => settingsStore,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    useMessage: () => useMessageMock,
    NAlert: defineComponent({
      props: { type: String, title: String },
      setup(props, { slots }) {
        return () => h('div', { class: `n-alert n-alert-${props.type || 'default'}` }, [
          props.title ? h('div', { class: 'n-alert-title' }, props.title) : null,
          slots.default?.(),
        ])
      },
    }),
    NButton: defineComponent({
      props: { loading: Boolean, disabled: Boolean, type: String },
      emits: ['click'],
      setup(props, { emit, slots }) {
        return () => h('button', {
          class: 'n-button',
          disabled: props.disabled,
          onClick: () => emit('click'),
        }, slots.default?.())
      },
    }),
    NCard: defineComponent({
      props: { title: String },
      setup(props, { slots }) {
        return () => h('div', { class: 'n-card' }, [
          props.title ? h('h3', { class: 'n-card-title' }, props.title) : null,
          h('div', { class: 'n-card-header-extra' }, slots['header-extra']?.()),
          h('div', { class: 'n-card-body' }, slots.default?.()),
        ])
      },
    }),
    NInput: defineComponent({
      props: { value: [String, Number], readonly: Boolean },
      setup(props) {
        return () => h('input', { class: 'n-input', value: props.value as any, readonly: props.readonly ?? true })
      },
    }),
    NInputGroup: defineComponent({
      setup(_props, { slots }) {
        return () => h('div', { class: 'n-input-group' }, slots.default?.())
      },
    }),
    NInputGroupLabel: defineComponent({
      setup(_props, { slots }) {
        return () => h('div', { class: 'n-input-group-label' }, slots.default?.())
      },
    }),
    NSelect: defineComponent({
      props: { value: String, options: { type: Array, default: () => [] }, disabled: Boolean, loading: Boolean },
      emits: ['update:value'],
      setup(props, { emit }) {
        return () => h('select', {
          class: 'n-select',
          disabled: props.disabled,
          value: props.value,
          onChange: (event: Event) => emit('update:value', (event.target as HTMLSelectElement).value),
        }, (props.options as Array<{ label: string; value: string }>).map((opt) => h('option', { value: opt.value }, opt.label)))
      },
    }),
    NSpace: defineComponent({
      setup(_props, { slots }) {
        return () => h('div', { class: 'n-space' }, slots.default?.())
      },
    }),
    NSwitch: defineComponent({
      props: { value: Boolean },
      emits: ['update:value'],
      setup(props, { emit }) {
        return () => h('button', {
          class: 'n-switch',
          onClick: () => emit('update:value', !props.value),
        }, props.value ? 'on' : 'off')
      },
    }),
    NTag: defineComponent({
      props: { type: String },
      setup(props, { slots }) {
        return () => h('span', { class: `n-tag n-tag-${props.type || 'default'}` }, slots.default?.())
      },
    }),
  }
})

import DevModeSettings from '@/components/hermes/settings/DevModeSettings.vue'

function resetStore() {
  settingsStore.dev = {
    enabled: false,
    review_base: 'fork-review/review-base',
    preview_branch: '',
  }
  settingsStore.saveSection.mockClear()
  settingsStore.updateLocal.mockClear()
}

describe('DevModeSettings', () => {
  beforeEach(() => {
    authState.isSuperAdmin = true
    resetStore()
    vi.clearAllMocks()
    fetchBranchBuildBranches.mockResolvedValue(['fork-review/review-base', 'fork-review/dev-a', 'fork-review/dev-b'])
    fetchBranchBuildStatus.mockResolvedValue({
      status: 'idle',
      previewBranch: null,
      previewWorktreePath: null,
      buildBranch: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      reviewBase: 'fork-review/review-base',
      logTail: [],
    })
    buildBranchPreview.mockResolvedValue({
      status: 'success',
      previewBranch: 'fork-review/dev-b',
      previewWorktreePath: '/tmp/worktree',
      buildBranch: 'fork-review/dev-b',
      startedAt: 1,
      finishedAt: 2,
      exitCode: 0,
      signal: null,
      error: null,
      reviewBase: 'fork-review/review-base',
      logTail: [],
      worktreePath: '/tmp/worktree',
    })
    resetBranchPreview.mockResolvedValue({
      status: 'success',
      previewBranch: 'fork-review/review-base',
      previewWorktreePath: '/tmp/review-base',
      buildBranch: 'fork-review/review-base',
      startedAt: null,
      finishedAt: 2,
      exitCode: 0,
      signal: null,
      error: null,
      reviewBase: 'fork-review/review-base',
      logTail: [],
    })
  })

  it('loads branches before Dev Mode is enabled and keeps status disabled without errors', async () => {
    const wrapper = mount(DevModeSettings, {
      global: {
        stubs: {
          SettingRow: {
            props: ['label', 'hint'],
            template: '<div class="setting-row"><div class="setting-row-label">{{ label }}</div><div class="setting-row-hint">{{ hint }}</div><slot /></div>',
          },
        },
      },
    })

    await flushPromises()

    expect(fetchBranchBuildBranches).toHaveBeenCalledTimes(1)
    expect(useMessageMock.error).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('settings.dev.disabledNote')
    expect(wrapper.findAll('select').length).toBe(3)
  })

  it('does not call status until save succeeds when enabling Dev Mode', async () => {
    const wrapper = mount(DevModeSettings, {
      global: {
        stubs: {
          SettingRow: {
            props: ['label', 'hint'],
            template: '<div class="setting-row"><div class="setting-row-label">{{ label }}</div><div class="setting-row-hint">{{ hint }}</div><slot /></div>',
          },
        },
      },
    })

    await flushPromises()
    fetchBranchBuildStatus.mockClear()
    settingsStore.saveSection.mockClear()

    const selects = wrapper.findAll('select')
    await selects[0].setValue('fork-review/dev-a')
    await selects[1].setValue('fork-review/dev-b')
    await wrapper.find('.n-switch').trigger('click')

    expect(settingsStore.dev.enabled).toBe(false)
    expect(fetchBranchBuildStatus).not.toHaveBeenCalled()

    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text() === 'common.save')!.trigger('click')
    await flushPromises()

    expect(settingsStore.saveSection).toHaveBeenCalledWith('dev', {
      enabled: true,
      review_base: 'fork-review/dev-a',
      preview_branch: 'fork-review/dev-b',
    })
    expect(fetchBranchBuildStatus).toHaveBeenCalledTimes(1)
    expect(useMessageMock.success).toHaveBeenCalledWith('settings.saved')
  })

  it('shows a permission alert and avoids branch API calls for non-super-admin users', async () => {
    authState.isSuperAdmin = false

    const wrapper = mount(DevModeSettings, {
      global: {
        stubs: {
          SettingRow: {
            props: ['label', 'hint'],
            template: '<div class="setting-row"><slot /></div>',
          },
        },
      },
    })

    await flushPromises()

    expect(fetchBranchBuildBranches).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('settings.dev.permissionTitle')
    expect(wrapper.text()).toContain('settings.dev.permissionBody')
  })
})
