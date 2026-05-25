<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'
import { NCheckbox, NDropdown, NTooltip, useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { Session } from '@/stores/hermes/chat'
import { useAppStore } from '@/stores/hermes/app'
import { useProfilesStore } from '@/stores/hermes/profiles'
import ProfileAvatar from '@/components/hermes/profiles/ProfileAvatar.vue'
import { copyToClipboard } from '@/utils/clipboard'
import { formatTimestampMs } from '@/shared/session-display'
import { createSessionActionOptions, promptSessionDelete } from './session-action-menu'

const props = withDefaults(defineProps<{
  session: Session
  active: boolean
  pinned: boolean
  canDelete: boolean
  streaming?: boolean
  selectable?: boolean
  selected?: boolean
  showProfile?: boolean
  to?: string
  menuMode?: 'simple' | 'chat'
}>(), {
  showProfile: true,
  menuMode: 'simple',
})

const emit = defineEmits<{
  select: []
  contextmenu: [event: MouseEvent]
  delete: []
  action: [key: string]
  'toggle-select': []
}>()

const { t } = useI18n()
const appStore = useAppStore()
const profilesStore = useProfilesStore()
const message = useMessage()
const dialog = useDialog()

const sessionModelName = computed(() =>
  props.session.model
    ? appStore.displayModelName(props.session.model, props.session.provider)
    : '',
)
const profileName = computed(() => props.session.profile || 'default')
const profileAvatar = computed(() => profilesStore.profiles.find(profile => profile.name === profileName.value)?.avatar)
const profileHasModels = computed(() => {
  const profileModels = appStore.profileModelGroups.find(profile => profile.profile === profileName.value)
  return !!profileModels?.groups?.some(group => group.models.length > 0)
})
const profileModelsMissing = computed(() =>
  appStore.profileModelGroups.length > 0 && !profileHasModels.value,
)

const menuTriggerLabel = computed(() => t('chat.sessionActions'))

const menuOptions = computed(() =>
  createSessionActionOptions(t, {
    mode: props.menuMode,
    pinned: props.pinned,
    canDelete: props.canDelete && !props.selectable,
    to: props.to,
    source: props.session.source,
  }),
)

let longPressTimer: ReturnType<typeof setTimeout> | null = null
const longPressTriggered = ref(false)

function onTouchStart(e: TouchEvent) {
  longPressTriggered.value = false
  longPressTimer = setTimeout(() => {
    longPressTriggered.value = true
    const touch = e.touches[0]
    const syntheticEvent = new MouseEvent('contextmenu', {
      clientX: touch.clientX,
      clientY: touch.clientY,
      bubbles: true,
    })
    emit('contextmenu', syntheticEvent)
  }, 500)
}

function onTouchEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function onTouchMove() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function isModifiedNavigation(event?: MouseEvent) {
  return !!event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
}

function onClick(event?: MouseEvent) {
  if (longPressTriggered.value) {
    longPressTriggered.value = false
    event?.preventDefault()
    return
  }
  if (isModifiedNavigation(event)) return
  if (props.to && !props.selectable) event?.preventDefault()
  emit('select')
}

async function openSessionLink() {
  if (!props.to || typeof window === 'undefined') return
  window.open(props.to, '_blank', 'noopener,noreferrer')
}

async function copySessionLink() {
  if (!props.to) return
  await copyToClipboard(props.to)
  message.success(t('chat.sessionLinkCopied'))
}

async function copySessionId() {
  await copyToClipboard(props.session.id)
  message.success(t('common.copied'))
}

function confirmDelete() {
  promptSessionDelete(dialog, t, props.session.title, () => emit('delete'))
}

async function handleMenuSelect(key: string) {
  switch (key) {
    case 'open-link':
      await openSessionLink()
      return
    case 'copy-link':
      await copySessionLink()
      return
    case 'copy-id':
      await copySessionId()
      return
    case 'delete':
      confirmDelete()
      return
    case 'pin':
    case 'rename':
    case 'workspace':
    case 'model':
    case 'export':
    case 'export-full':
    case 'export-full-json':
    case 'export-full-txt':
    case 'export-compressed':
    case 'export-compressed-json':
    case 'export-compressed-txt':
      emit('action', key)
      return
  }
}

onUnmounted(() => {
  if (longPressTimer) clearTimeout(longPressTimer)
})
</script>

<template>
  <div
    class="session-item-shell"
    :class="{ active, 'batch-mode': selectable, 'missing-models': profileModelsMissing, 'menu-mode-chat': menuMode === 'chat' }"
  >
    <component
      :is="selectable || !to ? 'button' : 'a'"
      class="session-item session-item-link"
      :class="{ active, 'batch-mode': selectable, 'missing-models': profileModelsMissing }"
      :aria-current="active ? 'page' : undefined"
      :href="!selectable ? to : undefined"
      :type="selectable || !to ? 'button' : undefined"
      @click="onClick"
      @contextmenu="emit('contextmenu', $event)"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
      @touchmove="onTouchMove"
    >
      <div v-if="selectable" class="session-item-checkbox">
        <NCheckbox :checked="selected" @click.stop="emit('toggle-select')" />
      </div>
      <div class="session-item-content">
        <span class="session-item-title-row">
          <span v-if="pinned" class="session-item-pin" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 17v5" />
              <path d="M5 8l14 0" />
              <path d="M8 3l8 0 0 5 3 5-14 0 3-5z" />
            </svg>
          </span>
          <span class="session-item-title">
            <svg v-if="streaming" class="session-item-streaming" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            {{ session.title }}
          </span>
          <NTooltip v-if="profileModelsMissing" trigger="click" placement="top">
            <template #trigger>
              <button class="session-item-warning" type="button" @click.stop.prevent>
                !
              </button>
            </template>
            {{ t('chat.profileMissingModelsTip', { profile: profileName }) }}
          </NTooltip>
        </span>
        <span class="session-item-meta">
          <span v-if="sessionModelName" class="session-item-model" :title="session.model">{{ sessionModelName }}</span>
          <span class="session-item-time">{{ formatTimestampMs(session.createdAt) }}</span>
        </span>
        <span v-if="props.showProfile" class="session-item-profile">
          <ProfileAvatar class="session-item-profile-avatar" :name="profileName" :avatar="profileAvatar" :size="16" />
          <span class="session-item-profile-name">{{ profileName }}</span>
        </span>
      </div>
    </component>

    <div v-if="!selectable" class="session-item-actions">
      <NDropdown
        trigger="click"
        placement="bottom-end"
        :options="menuOptions"
        @select="handleMenuSelect"
      >
        <button
          class="session-item-more"
          type="button"
          aria-haspopup="menu"
          :aria-label="menuTriggerLabel"
          :title="menuTriggerLabel"
          @pointerdown.stop.prevent
          @click.stop.prevent
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>
      </NDropdown>
    </div>
  </div>
</template>

<style scoped>
.session-item-shell {
  --session-item-actions-width: 34px;
  position: relative;
  width: 100%;
  margin-bottom: 2px;
}

.session-item-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  padding-right: 10px;
  border: none;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  text-align: left;
  text-decoration: none;
  color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease, padding-right 0.15s ease;
}

.session-item-shell:hover .session-item-link,
.session-item-shell:focus-within .session-item-link {
  background: rgba(var(--accent-primary-rgb), 0.06);
  color: var(--text-primary);
}

.session-item-link.active {
  background: rgba(var(--accent-primary-rgb), 0.12);
  color: var(--text-primary);
  font-weight: 500;
}

.session-item-link.active .session-item-title {
  color: var(--accent-primary);
}

.session-item-shell.missing-models .session-item-link {
  color: #b42318;
  background: rgba(220, 38, 38, 0.08);
}

.session-item-shell.missing-models .session-item-title,
.session-item-shell.missing-models .session-item-profile-name,
.session-item-shell.missing-models .session-item-time {
  color: #b42318;
}

.session-item-shell.missing-models .session-item-model {
  color: #b42318;
  background: rgba(220, 38, 38, 0.12);
}

.session-item-shell.missing-models:hover .session-item-link,
.session-item-shell.missing-models:focus-within .session-item-link {
  background: rgba(220, 38, 38, 0.12);
}

.session-item-checkbox {
  flex-shrink: 0;
}

.session-item-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.session-item-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.session-item-title {
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-item-streaming {
  display: inline-block;
  flex-shrink: 0;
  margin-right: 4px;
  vertical-align: middle;
  animation: spin 1.2s linear infinite;
  color: var(--accent-primary);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.session-item-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--accent-primary);
}

.session-item-time {
  font-size: 11px;
  color: var(--text-muted);
}

.session-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  min-width: 0;
}

.session-item-model {
  max-width: 100%;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(var(--accent-primary-rgb), 0.08);
  color: var(--accent-primary);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item-profile {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin-top: 4px;
}

.session-item-profile-avatar {
  background: var(--bg-secondary);
}

.session-item-profile-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
  color: var(--text-muted);
}

.session-item-warning {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 1px solid rgba(180, 35, 24, 0.35);
  border-radius: 50%;
  background: rgba(220, 38, 38, 0.1);
  color: #b42318;
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  cursor: pointer;
}

.session-item-actions {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%) translateX(4px);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.session-item-shell:hover .session-item-actions,
.session-item-shell:focus-within .session-item-actions {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
  pointer-events: auto;
}

.session-item-shell:hover .session-item-link,
.session-item-shell:focus-within .session-item-link {
  padding-right: calc(10px + var(--session-item-actions-width));
}

.session-item-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--session-item-actions-width);
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
}

.session-item-more:hover,
.session-item-more:focus-visible {
  background: rgba(var(--accent-primary-rgb), 0.12);
  color: var(--text-primary);
}

@media (hover: none) {
  .session-item-actions {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
    pointer-events: auto;
  }

  .session-item-link {
    padding-right: calc(10px + var(--session-item-actions-width));
  }
}
</style>
