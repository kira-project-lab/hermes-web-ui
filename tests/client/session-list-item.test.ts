// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import SessionListItem from '@/components/hermes/chat/SessionListItem.vue'

const useDialogWarning = vi.fn()
const useMessageSuccess = vi.fn()

vi.mock('@/stores/hermes/app', () => ({
  useAppStore: () => ({
    profileModelGroups: [],
    displayModelName: (model: string) => model,
  }),
}))

vi.mock('@/stores/hermes/profiles', () => ({
  useProfilesStore: () => ({ profiles: [] }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/shared/session-display', () => ({
  formatTimestampMs: () => 'now',
}))

vi.mock('naive-ui', () => ({
  NCheckbox: defineComponent({
    name: 'NCheckbox',
    props: ['checked'],
    emits: ['click'],
    template: '<input type="checkbox" :checked="checked" @click="$emit(\'click\')" />',
  }),
  NDropdown: defineComponent({
    name: 'NDropdown',
    props: ['options', 'trigger', 'placement'],
    emits: ['select'],
    template: '<div class="n-dropdown-stub"><slot /></div>',
  }),
  NTooltip: defineComponent({
    name: 'NTooltip',
    template: '<span><slot name="trigger" /><slot /></span>',
  }),
  useDialog: () => ({ warning: useDialogWarning }),
  useMessage: () => ({ success: useMessageSuccess }),
}))

const session = {
  id: 's1',
  title: 'Session One',
  model: 'gpt-test',
  provider: 'openai',
  createdAt: Date.now(),
  profile: 'kira',
}

describe('SessionListItem', () => {
  it('renders normal mode with a detached hover-only actions trigger and no delete button', () => {
    const wrapper = mount(SessionListItem, {
      props: {
        session,
        active: false,
        pinned: false,
        canDelete: true,
        to: '/session/s1',
      },
      global: {
        stubs: {
          ProfileAvatar: true,
        },
      },
    })

    expect(wrapper.get('.session-item-shell').exists()).toBe(true)
    expect(wrapper.get('a.session-item-link').attributes('href')).toBe('/session/s1')
    expect(wrapper.find('button.session-item-more').exists()).toBe(true)
    expect(wrapper.find('button.session-item-delete').exists()).toBe(false)
    expect(wrapper.get('.session-item-actions').attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.get('button.session-item-more').attributes('aria-haspopup')).toBe('menu')
    expect(wrapper.get('button.session-item-more').element.closest('.session-item-link')).toBeNull()
  })

  it('renders selectable mode as a button and hides action controls', () => {
    const wrapper = mount(SessionListItem, {
      props: {
        session,
        active: false,
        pinned: false,
        canDelete: true,
        selectable: true,
        selected: false,
        to: '/session/s1',
      },
      global: {
        stubs: {
          ProfileAvatar: true,
        },
      },
    })

    expect(wrapper.find('button.session-item-link').exists()).toBe(true)
    expect(wrapper.find('a.session-item-link').exists()).toBe(false)
    expect(wrapper.find('button.session-item-more').exists()).toBe(false)
  })

  it('exposes the chat action menu when configured for chat mode', () => {
    const wrapper = mount(SessionListItem, {
      props: {
        session,
        active: false,
        pinned: true,
        canDelete: true,
        menuMode: 'chat',
        to: '/session/s1',
      },
      global: {
        stubs: {
          ProfileAvatar: true,
        },
      },
    })

    const options = wrapper.getComponent({ name: 'NDropdown' }).props('options') as Array<{ label?: string; key?: string; children?: Array<{ label?: string; key?: string }> }>
    expect(options.map(option => option.label)).toEqual(expect.arrayContaining([
      'chat.unpin',
      'chat.rename',
      'chat.setWorkspace',
      'chat.export',
      'chat.openSessionInNewTab',
      'chat.copySessionLink',
      'chat.copySessionId',
      'chat.deleteSession',
    ]))
    expect(options.some(option => option.key === 'export')).toBe(true)
  })

  it('does not select the row when clicking the actions trigger', async () => {
    const wrapper = mount(SessionListItem, {
      props: {
        session,
        active: false,
        pinned: false,
        canDelete: true,
        to: '/session/s1',
      },
      global: {
        stubs: {
          ProfileAvatar: true,
        },
      },
    })

    await wrapper.get('button.session-item-more').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('does not hijack modified clicks on normal links', async () => {
    const wrapper = mount(SessionListItem, {
      props: {
        session,
        active: false,
        pinned: false,
        canDelete: true,
        to: '/session/s1',
      },
      global: {
        stubs: {
          ProfileAvatar: true,
        },
      },
    })

    const link = wrapper.get('a.session-item-link')
    link.element.addEventListener('click', event => event.preventDefault())
    await link.trigger('click', { ctrlKey: true })
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
