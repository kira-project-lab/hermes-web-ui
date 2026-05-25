<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NInputGroup, NInputGroupLabel, NSelect, NSpace, NSwitch, NTag, NCard, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/hermes/settings'
import {
  buildBranchPreview,
  fetchBranchBuildBranches,
  fetchBranchBuildStatus,
  resetBranchPreview,
  type BranchBuildSummary,
} from '@/api/hermes/dev-mode-branch-builds'
import SettingRow from './SettingRow.vue'

const settingsStore = useSettingsStore()
const message = useMessage()
const { t } = useI18n()

const loading = ref(false)
const branchList = ref<string[]>([])
const selectedBranch = ref('')
const branchBuild = ref<BranchBuildSummary | null>(null)
const saving = ref(false)
const running = ref(false)

const devEnabled = computed(() => !!settingsStore.dev.enabled)
const reviewBase = computed({
  get: () => settingsStore.dev.review_base || 'fork-review/review-base',
  set: (value: string) => {
    settingsStore.updateLocal('dev', { review_base: value })
  },
})
const previewBranch = computed({
  get: () => settingsStore.dev.preview_branch || '',
  set: (value: string) => {
    settingsStore.updateLocal('dev', { preview_branch: value })
  },
})

function statusType(status: BranchBuildSummary['status']) {
  switch (status) {
    case 'running': return 'warning'
    case 'success': return 'success'
    case 'failed': return 'error'
    default: return 'default'
  }
}

function fmtTime(value: number | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

async function refreshStatus() {
  if (!devEnabled.value) {
    branchBuild.value = null
    return
  }
  try {
    loading.value = true
    const [status, branches] = await Promise.all([
      fetchBranchBuildStatus(),
      fetchBranchBuildBranches(),
    ])
    branchBuild.value = status
    branchList.value = branches
    if (!selectedBranch.value || !branches.includes(selectedBranch.value)) {
      selectedBranch.value = status.buildBranch || status.previewBranch || branches[0] || ''
    }
    if (status.previewBranch) {
      settingsStore.updateLocal('dev', { preview_branch: status.previewBranch, review_base: status.reviewBase })
    }
  } catch (err: any) {
    message.error(err?.message || t('settings.dev.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function saveDevSettings() {
  saving.value = true
  try {
    await settingsStore.saveSection('dev', {
      enabled: settingsStore.dev.enabled,
      review_base: reviewBase.value,
      preview_branch: previewBranch.value,
    })
    message.success(t('settings.saved'))
  } catch (err: any) {
    message.error(err?.message || t('settings.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function buildSelectedBranch() {
  if (!selectedBranch.value) {
    message.warning(t('settings.dev.branchRequired'))
    return
  }
  running.value = true
  try {
    const result = await buildBranchPreview(selectedBranch.value)
    branchBuild.value = result
    settingsStore.updateLocal('dev', {
      preview_branch: result.previewBranch,
      review_base: result.reviewBase,
    })
    message.success(t('settings.dev.buildStarted'))
    await refreshStatus()
  } catch (err: any) {
    message.error(err?.message || t('settings.dev.buildFailed'))
  } finally {
    running.value = false
  }
}

async function resetToReviewBase() {
  running.value = true
  try {
    const result = await resetBranchPreview()
    branchBuild.value = result
    settingsStore.updateLocal('dev', {
      preview_branch: result.previewBranch,
      review_base: result.reviewBase,
    })
    message.success(t('settings.dev.resetDone'))
    await refreshStatus()
  } catch (err: any) {
    message.error(err?.message || t('settings.dev.resetFailed'))
  } finally {
    running.value = false
  }
}

watch(devEnabled, async (enabled) => {
  if (enabled) {
    await refreshStatus()
  } else {
    branchBuild.value = null
  }
})

onMounted(async () => {
  if (devEnabled.value) {
    await refreshStatus()
  }
})
</script>

<template>
  <section class="settings-section dev-mode-settings">
    <NAlert type="warning" class="dev-warning" :title="t('settings.dev.warningTitle')">
      {{ t('settings.dev.warningBody') }}
    </NAlert>

    <SettingRow :label="t('settings.dev.enabled')" :hint="t('settings.dev.enabledHint')">
      <NSwitch
        :value="devEnabled"
        @update:value="(value) => settingsStore.updateLocal('dev', { enabled: value })"
      />
    </SettingRow>

    <SettingRow :label="t('settings.dev.reviewBase')" :hint="t('settings.dev.reviewBaseHint')">
      <NInput
        :value="reviewBase"
        size="small"
        class="input-lg"
        :disabled="!devEnabled"
        @update:value="reviewBase = $event"
      />
    </SettingRow>

    <SettingRow :label="t('settings.dev.previewBranch')" :hint="t('settings.dev.previewBranchHint')">
      <NInput
        :value="previewBranch"
        size="small"
        class="input-lg"
        :disabled="!devEnabled"
        @update:value="previewBranch = $event"
      />
    </SettingRow>

    <div class="actions">
      <NSpace>
        <NButton type="primary" :loading="saving" :disabled="!devEnabled" @click="saveDevSettings">
          {{ t('common.save') }}
        </NButton>
        <NButton :loading="loading" :disabled="!devEnabled" @click="refreshStatus">
          {{ t('settings.dev.refresh') }}
        </NButton>
      </NSpace>
    </div>

    <NCard v-if="devEnabled" size="small" class="branch-preview-card" :title="t('settings.dev.branchPreviewTitle')">
      <template #header-extra>
        <NTag :type="statusType(branchBuild?.status || 'idle')" size="small">
          {{ branchBuild?.status || 'idle' }}
        </NTag>
      </template>

      <div class="branch-preview-grid">
        <div class="branch-preview-field">
          <div class="field-label">{{ t('settings.dev.availableBranches') }}</div>
          <NSelect
            v-model:value="selectedBranch"
            filterable
            :loading="loading"
            :options="branchList.map((branch) => ({ label: branch, value: branch }))"
            :placeholder="t('settings.dev.branchPlaceholder')"
            :disabled="running"
          />
        </div>

        <NInputGroup>
          <NInputGroupLabel>{{ t('settings.dev.previewNow') }}</NInputGroupLabel>
          <NInput :value="branchBuild?.previewBranch || '—'" readonly />
        </NInputGroup>

        <NInputGroup>
          <NInputGroupLabel>{{ t('settings.dev.buildBranch') }}</NInputGroupLabel>
          <NInput :value="branchBuild?.buildBranch || '—'" readonly />
        </NInputGroup>

        <NInputGroup>
          <NInputGroupLabel>{{ t('settings.dev.worktreePath') }}</NInputGroupLabel>
          <NInput :value="branchBuild?.previewWorktreePath || '—'" readonly />
        </NInputGroup>

        <NInputGroup>
          <NInputGroupLabel>{{ t('settings.dev.reviewBase') }}</NInputGroupLabel>
          <NInput :value="branchBuild?.reviewBase || reviewBase" readonly />
        </NInputGroup>
      </div>

      <div class="actions">
        <NSpace>
          <NButton type="info" :loading="running" :disabled="!selectedBranch || !branchList.length" @click="buildSelectedBranch">
            {{ t('settings.dev.buildBranchAction') }}
          </NButton>
          <NButton :loading="running" @click="resetToReviewBase">
            {{ t('settings.dev.resetPreview') }}
          </NButton>
        </NSpace>
      </div>

      <div class="meta-grid">
        <div><strong>{{ t('settings.dev.startedAt') }}:</strong> {{ fmtTime(branchBuild?.startedAt || null) }}</div>
        <div><strong>{{ t('settings.dev.finishedAt') }}:</strong> {{ fmtTime(branchBuild?.finishedAt || null) }}</div>
        <div><strong>{{ t('settings.dev.exitCode') }}:</strong> {{ branchBuild?.exitCode ?? '—' }}</div>
        <div><strong>{{ t('settings.dev.signal') }}:</strong> {{ branchBuild?.signal || '—' }}</div>
      </div>

      <div v-if="branchBuild?.error" class="error-block">
        <strong>{{ t('settings.dev.lastError') }}:</strong> {{ branchBuild.error }}
      </div>

      <pre class="log-tail">{{ branchBuild?.logTail?.join('\n') || t('settings.dev.noLogs') }}</pre>
    </NCard>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.dev-warning {
  margin-bottom: 16px;
}

.actions {
  margin: 12px 0 8px;
}

.branch-preview-card {
  margin-top: 16px;
}

.branch-preview-grid {
  display: grid;
  gap: 12px;
}

.branch-preview-field {
  display: grid;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: $text-muted;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 16px;
  font-size: 12px;
  color: $text-primary;
}

.error-block {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(220, 38, 38, 0.08);
  color: $text-primary;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-tail {
  margin-top: 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  white-space: pre-wrap;
  overflow: auto;
  max-height: 240px;
  font-size: 12px;
  line-height: 1.5;
}

:deep(.n-input-group-label) {
  min-width: 120px;
}
</style>
