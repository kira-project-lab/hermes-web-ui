<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NInputGroup, NInputGroupLabel, NSelect, NSpace, NSwitch, NTag, NCard, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { isStoredSuperAdmin } from '@/api/client'
import { useSettingsStore } from '@/stores/hermes/settings'
import {
  buildBranchPreview,
  fetchBranchBuildBranches,
  fetchBranchBuildStatus,
  resetBranchPreview,
  type BranchBuildSummary,
} from '@/api/hermes/dev-mode-branch-builds'
import SettingRow from './SettingRow.vue'

const DEFAULT_REVIEW_BASE = 'fork-review/review-base'

const settingsStore = useSettingsStore()
const message = useMessage()
const { t } = useI18n()

const loading = ref(false)
const branchList = ref<string[]>([])
const selectedBranch = ref('')
const branchBuild = ref<BranchBuildSummary | null>(null)
const saving = ref(false)
const running = ref(false)
const draftEnabled = ref(false)
const draftReviewBase = ref(DEFAULT_REVIEW_BASE)
const draftPreviewBranch = ref('')
const canUseDevMode = computed(() => isStoredSuperAdmin())

const persistedDevEnabled = computed(() => !!settingsStore.dev.enabled)
const branchOptions = computed(() => branchList.value.map((branch) => ({ label: branch, value: branch })))
const settingsChanged = computed(() => draftEnabled.value !== persistedDevEnabled.value ||
  draftReviewBase.value !== (settingsStore.dev.review_base || DEFAULT_REVIEW_BASE) ||
  draftPreviewBranch.value !== (settingsStore.dev.preview_branch || ''))
const canRunPreviewActions = computed(() => canUseDevMode.value && persistedDevEnabled.value)

function syncDraftFromStore() {
  draftEnabled.value = !!settingsStore.dev.enabled
  draftReviewBase.value = settingsStore.dev.review_base || DEFAULT_REVIEW_BASE
  draftPreviewBranch.value = settingsStore.dev.preview_branch || ''
  if (!selectedBranch.value && draftPreviewBranch.value) {
    selectedBranch.value = draftPreviewBranch.value
  }
}

function ensureSelectedBranches() {
  if (!draftReviewBase.value && branchList.value.includes(DEFAULT_REVIEW_BASE)) {
    draftReviewBase.value = DEFAULT_REVIEW_BASE
  }
  if (!draftReviewBase.value && branchList.value.length) {
    draftReviewBase.value = branchList.value[0]
  }
  if (!selectedBranch.value || !branchList.value.includes(selectedBranch.value)) {
    selectedBranch.value = draftPreviewBranch.value && branchList.value.includes(draftPreviewBranch.value)
      ? draftPreviewBranch.value
      : branchList.value[0] || ''
  }
}

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

async function refreshBranches() {
  if (!canUseDevMode.value) return
  loading.value = true
  try {
    branchList.value = await fetchBranchBuildBranches()
    ensureSelectedBranches()
  } catch (err: any) {
    message.error(err?.message || t('settings.dev.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function refreshStatus() {
  if (!canUseDevMode.value) return
  loading.value = true
  try {
    const [status, branches] = await Promise.all([
      fetchBranchBuildStatus(),
      fetchBranchBuildBranches(),
    ])
    branchBuild.value = status
    branchList.value = branches
    if (status.previewBranch) {
      draftPreviewBranch.value = status.previewBranch
    }
    if (status.reviewBase) {
      draftReviewBase.value = status.reviewBase
    }
    ensureSelectedBranches()
  } catch (err: any) {
    message.error(err?.message || t('settings.dev.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function saveDevSettings() {
  if (!canUseDevMode.value) return
  saving.value = true
  try {
    await settingsStore.saveSection('dev', {
      enabled: draftEnabled.value,
      review_base: draftReviewBase.value,
      preview_branch: draftPreviewBranch.value,
    })
    syncDraftFromStore()
    message.success(t('settings.saved'))
    await refreshStatus()
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
    draftPreviewBranch.value = result.previewBranch || selectedBranch.value
    draftReviewBase.value = result.reviewBase || draftReviewBase.value
    settingsStore.updateLocal('dev', {
      preview_branch: draftPreviewBranch.value,
      review_base: draftReviewBase.value,
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
    draftPreviewBranch.value = result.previewBranch || ''
    draftReviewBase.value = result.reviewBase || draftReviewBase.value
    settingsStore.updateLocal('dev', {
      preview_branch: draftPreviewBranch.value,
      review_base: draftReviewBase.value,
    })
    message.success(t('settings.dev.resetDone'))
    await refreshStatus()
  } catch (err: any) {
    message.error(err?.message || t('settings.dev.resetFailed'))
  } finally {
    running.value = false
  }
}

watch(() => ({ ...settingsStore.dev }), () => {
  syncDraftFromStore()
}, { immediate: true })

onMounted(async () => {
  await refreshStatus()
})
</script>

<template>
  <section class="settings-section dev-mode-settings">
    <NAlert type="warning" class="dev-warning" :title="t('settings.dev.warningTitle')">
      {{ t('settings.dev.warningBody') }}
    </NAlert>

    <NAlert v-if="!canUseDevMode" type="error" class="dev-warning" :title="t('settings.dev.permissionTitle')">
      {{ t('settings.dev.permissionBody') }}
    </NAlert>

    <SettingRow :label="t('settings.dev.enabled')" :hint="t('settings.dev.enabledHint')">
      <NSwitch
        :value="draftEnabled"
        :disabled="!canUseDevMode"
        @update:value="(value) => { draftEnabled = value }"
      />
    </SettingRow>

    <SettingRow :label="t('settings.dev.reviewBase')" :hint="t('settings.dev.reviewBaseHint')">
      <NSelect
        v-model:value="draftReviewBase"
        filterable
        size="small"
        class="input-lg"
        :loading="loading"
        :options="branchOptions"
        :placeholder="t('settings.dev.reviewBasePlaceholder')"
        :disabled="!canUseDevMode || running"
      />
    </SettingRow>

    <SettingRow :label="t('settings.dev.previewBranch')" :hint="t('settings.dev.previewBranchHint')">
      <NSelect
        v-model:value="draftPreviewBranch"
        filterable
        clearable
        size="small"
        class="input-lg"
        :loading="loading"
        :options="branchOptions"
        :placeholder="t('settings.dev.previewBranchPlaceholder')"
        :disabled="!canUseDevMode || running"
      />
    </SettingRow>

    <div class="actions">
      <NSpace>
        <NButton type="primary" :loading="saving" :disabled="!canUseDevMode || !settingsChanged" @click="saveDevSettings">
          {{ t('common.save') }}
        </NButton>
        <NButton :loading="loading" :disabled="!canUseDevMode" @click="refreshStatus">
          {{ t('settings.dev.refresh') }}
        </NButton>
        <NButton :loading="loading" :disabled="!canUseDevMode" @click="refreshBranches">
          {{ t('settings.dev.refreshBranches') }}
        </NButton>
      </NSpace>
    </div>

    <NAlert v-if="canUseDevMode && !persistedDevEnabled" type="info" class="dev-disabled-note">
      {{ t('settings.dev.disabledNote') }}
    </NAlert>

    <NCard v-if="canUseDevMode" size="small" class="branch-preview-card" :title="t('settings.dev.branchPreviewTitle')">
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
            :options="branchOptions"
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
          <NInput :value="branchBuild?.reviewBase || draftReviewBase" readonly />
        </NInputGroup>
      </div>

      <div class="actions">
        <NSpace>
          <NButton type="info" :loading="running" :disabled="!canRunPreviewActions || !selectedBranch || !branchList.length" @click="buildSelectedBranch">
            {{ t('settings.dev.buildBranchAction') }}
          </NButton>
          <NButton :loading="running" :disabled="!canRunPreviewActions" @click="resetToReviewBase">
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

.dev-warning,
.dev-disabled-note {
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
