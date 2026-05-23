<script setup lang="ts">
import { ref } from 'vue'
import { NSwitch, NSelect, NButton, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/hermes/settings'
import { useTheme, type BrightnessMode } from '@/composables/useTheme'
import SettingRow from './SettingRow.vue'

const settingsStore = useSettingsStore()
const message = useMessage()
const { t } = useI18n()
const { brightness, setBrightness } = useTheme()

const themeOptions = [
  { label: t('settings.display.themeLight'), value: 'light' },
  { label: t('settings.display.themeDark'), value: 'dark' },
  { label: t('settings.display.themeSystem'), value: 'system' },
]

async function save(values: Record<string, any>) {
  try {
    await settingsStore.saveSection('display', values)
    message.success(t('settings.saved'))
  } catch (err: any) {
    message.error(t('settings.saveFailed'))
  }
}

function handleThemeChange(val: string) {
  const m = val as BrightnessMode
  setBrightness(m)
  save({ skin: m })
}

const animationUploading = ref(false)
const animationFileInput = ref<HTMLInputElement | null>(null)

async function handleAnimationFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  animationUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/hermes/upload/thinking-animation', { method: 'POST', body: fd })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(err.error || res.statusText)
    }
    const { url } = await res.json()
    await save({ thinking_video_url: url })
  } catch (err: any) {
    message.error(err.message || t('settings.saveFailed'))
  } finally {
    animationUploading.value = false
    if (animationFileInput.value) animationFileInput.value.value = ''
  }
}

async function clearAnimation() {
  await save({ thinking_video_url: undefined })
}
</script>

<template>
  <section class="settings-section">
    <SettingRow :label="t('settings.display.theme')" :hint="t('settings.display.themeHint')">
      <NSelect :value="brightness" :options="themeOptions" size="small" :consistent-menu-width="false" class="input-sm" @update:value="handleThemeChange" />
    </SettingRow>
    <SettingRow :label="t('settings.display.streaming')" :hint="t('settings.display.streamingHint')">
      <NSwitch :value="settingsStore.display.streaming" @update:value="v => save({ streaming: v })" />
    </SettingRow>
    <SettingRow :label="t('settings.display.compact')" :hint="t('settings.display.compactHint')">
      <NSwitch :value="settingsStore.display.compact" @update:value="v => save({ compact: v })" />
    </SettingRow>
    <SettingRow :label="t('settings.display.showReasoning')" :hint="t('settings.display.showReasoningHint')">
      <NSwitch :value="settingsStore.display.show_reasoning" @update:value="v => save({ show_reasoning: v })" />
    </SettingRow>
    <SettingRow :label="t('settings.display.showCost')" :hint="t('settings.display.showCostHint')">
      <NSwitch :value="settingsStore.display.show_cost" @update:value="v => save({ show_cost: v })" />
    </SettingRow>
    <SettingRow :label="t('settings.display.inlineDiffs')" :hint="t('settings.display.inlineDiffsHint')">
      <NSwitch :value="settingsStore.display.inline_diffs" @update:value="v => save({ inline_diffs: v })" />
    </SettingRow>
    <SettingRow :label="t('settings.display.bellOnComplete')" :hint="t('settings.display.bellOnCompleteHint')">
      <NSwitch :value="settingsStore.display.bell_on_complete" @update:value="v => save({ bell_on_complete: v })" />
    </SettingRow>
    <SettingRow :label="t('settings.display.busyInputMode')" :hint="t('settings.display.busyInputModeHint')">
      <NSwitch :value="settingsStore.display.busy_input_mode === 'interrupt'" @update:value="v => save({ busy_input_mode: v ? 'interrupt' : 'off' })" />
    </SettingRow>
    <SettingRow :label="t('settings.display.thinkingVideoUrl')" :hint="t('settings.display.thinkingVideoUrlHint')">
      <div class="animation-upload">
        <span v-if="settingsStore.display.thinking_video_url" class="animation-filename">
          {{ settingsStore.display.thinking_video_url.split('/').pop() }}
        </span>
        <NButton size="small" :loading="animationUploading" @click="animationFileInput?.click()">
          {{ settingsStore.display.thinking_video_url ? t('settings.display.thinkingVideoUrlReplace') : t('settings.display.thinkingVideoUrlUpload') }}
        </NButton>
        <NButton v-if="settingsStore.display.thinking_video_url" size="small" @click="clearAnimation">
          {{ t('settings.display.thinkingVideoUrlClear') }}
        </NButton>
        <input
          ref="animationFileInput"
          type="file"
          accept=".gif,.mp4,.webm,.png,.jpg,.jpeg,.webp"
          style="display:none"
          @change="handleAnimationFile"
        />
      </div>
    </SettingRow>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.settings-section {
  margin-top: 16px;
}

.animation-upload {
  display: flex;
  align-items: center;
  gap: 8px;
}

.animation-filename {
  font-size: 12px;
  opacity: 0.7;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
