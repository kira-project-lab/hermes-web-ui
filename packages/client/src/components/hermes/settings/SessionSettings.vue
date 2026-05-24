<script setup lang="ts">
import { computed, onMounted } from "vue";
import { NInputNumber, NSelect, NSwitch, NInput, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/hermes/settings";
import { useSessionBrowserPrefsStore } from "@/stores/hermes/session-browser-prefs";
import { useModelsStore } from "@/stores/hermes/models";
import SettingRow from "./SettingRow.vue";

const settingsStore = useSettingsStore();
const sessionBrowserPrefsStore = useSessionBrowserPrefsStore();
const modelsStore = useModelsStore();
const message = useMessage();
const { t } = useI18n();

const titleModelOptions = computed(() =>
  modelsStore.allModels.map(model => ({
    label: `${model.label} / ${model.id}`,
    value: model.id,
  })),
);

onMounted(() => {
  if (modelsStore.providers.length === 0) {
    void modelsStore.fetchProviders();
  }
});

// 防抖保存：每个字段独立定时器，300ms 内只发最后一次 HTTP 请求
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function save(section: string, values: Record<string, any>) {
  // NSelect/NSwitch 等一次性操作，直接保存，不需要防抖
  settingsStore.updateLocal(section, values)
  settingsStore.saveSection(section, values).then(() => {
    message.success(t("settings.saved"));
  }).catch(() => {
    message.error(t("settings.saveFailed"));
  });
}

function debouncedSave(section: string, key: string, value: any) {
  // 先立即更新本地 store（UI 即时响应）
  settingsStore.updateLocal(section, { [key]: value });
  // 再防抖发 HTTP 保存
  if (debounceTimers[key]) clearTimeout(debounceTimers[key])
  debounceTimers[key] = setTimeout(async () => {
    try {
      await settingsStore.saveSection(section, { [key]: value });
      message.success(t("settings.saved"));
    } catch (err: any) {
      message.error(t("settings.saveFailed"));
    }
  }, 300);
}

async function toggleRequireAuth(value: boolean) {
  try {
    await settingsStore.saveSection("approvals", { mode: value ? "manual" : "off" });
    message.success(t("settings.saved"));
  } catch (err: any) {
    message.error(t("settings.saveFailed"));
  }
}
</script>

<template>
  <section class="settings-section">
    <SettingRow
      label="Session title generation"
      hint="Automatically draft a title for newly created sessions"
    >
      <NSwitch
        :value="settingsStore.sessionTitleGeneration.enabled"
        @update:value="v => save('session_title_generation', { enabled: v })"
      />
    </SettingRow>
    <SettingRow
      label="Title model"
      hint="Model used to generate the session title"
    >
      <NSelect
        :value="settingsStore.sessionTitleGeneration.model || ''"
        :options="titleModelOptions"
        size="small"
        :consistent-menu-width="false"
        class="input-md"
        :disabled="!settingsStore.sessionTitleGeneration.enabled"
        @update:value="v => save('session_title_generation', { model: v })"
      />
    </SettingRow>
    <SettingRow
      label="Title prompt"
      hint="Prompt template used when generating the session title"
    >
      <NInput
        :value="settingsStore.sessionTitleGeneration.prompt || ''"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 6 }"
        size="small"
        class="input-lg"
        :disabled="!settingsStore.sessionTitleGeneration.enabled"
        @update:value="v => debouncedSave('session_title_generation', 'prompt', v)"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.requireAuth')"
      :hint="t('settings.session.requireAuthHint')"
    >
      <NSwitch :value="settingsStore.approvals.mode === 'manual'" @update:value="toggleRequireAuth" />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.mode')"
      :hint="t('settings.session.modeHint')"
    >
      <NSelect
        :value="settingsStore.sessionReset.mode || 'both'"
        :options="[
          { label: t('settings.session.modeBoth'), value: 'both' },
          { label: t('settings.session.modeIdle'), value: 'idle' },
          { label: t('settings.session.modeDaily'), value: 'daily' },
          { label: t('settings.session.modeNone'), value: 'none' },
        ]"
        size="small"
        class="input-md"
        @update:value="(v) => save('session_reset', { mode: v })"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.idleMinutes')"
      :hint="t('settings.session.idleMinutesHint')"
    >
      <NInputNumber
        :value="settingsStore.sessionReset.idle_minutes"
        :min="10"
        :max="10080"
        :step="30"
        size="small"
        class="input-sm"
        @update:value="(v) => v != null && debouncedSave('session_reset', 'idle_minutes', v)"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.atHour')"
      :hint="t('settings.session.atHourHint')"
    >
      <NInputNumber
        :value="settingsStore.sessionReset.at_hour"
        :min="0"
        :max="23"
        :step="1"
        size="small"
        class="input-sm"
        @update:value="(v) => v != null && debouncedSave('session_reset', 'at_hour', v)"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.liveMonitorHumanOnly')"
      :hint="t('settings.session.liveMonitorHumanOnlyHint')"
    >
      <NSwitch
        :value="sessionBrowserPrefsStore.humanOnly"
        @update:value="(value) => sessionBrowserPrefsStore.setHumanOnly(value)"
      />
    </SettingRow>
  </section>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.settings-section {
  margin-top: 16px;
}
</style>
