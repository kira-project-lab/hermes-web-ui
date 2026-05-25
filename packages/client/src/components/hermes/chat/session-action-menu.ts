import { h } from 'vue'
import type { DropdownOption } from 'naive-ui'

export type SessionActionMenuMode = 'simple' | 'chat'

export type SessionActionKey =
  | 'pin'
  | 'rename'
  | 'workspace'
  | 'model'
  | 'export'
  | 'export-full'
  | 'export-full-json'
  | 'export-full-txt'
  | 'export-compressed'
  | 'export-compressed-json'
  | 'export-compressed-txt'
  | 'open-link'
  | 'copy-link'
  | 'copy-id'
  | 'delete'

export type SessionActionTranslator = (key: string, params?: Record<string, unknown>) => string

export interface SessionActionMenuContext {
  mode?: SessionActionMenuMode
  pinned: boolean
  canDelete: boolean
  to?: string | null
  source?: string | null
}

export interface SessionDeleteDialog {
  warning: (options: Record<string, unknown>) => void
}

export function createSessionActionOptions(
  t: SessionActionTranslator,
  context: SessionActionMenuContext,
): DropdownOption[] {
  const options: DropdownOption[] = []
  const { mode = 'simple', pinned, canDelete, to, source } = context

  if (mode === 'chat') {
    options.push(
      { label: t(pinned ? 'chat.unpin' : 'chat.pin'), key: 'pin' },
      { label: t('chat.rename'), key: 'rename' },
      { label: t('chat.setWorkspace'), key: 'workspace' },
    )

    if (source === 'cli') {
      options.push({ label: t('chat.setModel'), key: 'model' })
    }

    options.push({
      label: t('chat.export'),
      key: 'export',
      children: [
        {
          label: t('chat.exportFull'),
          key: 'export-full',
          children: [
            { label: 'JSON', key: 'export-full-json' },
            { label: 'TXT', key: 'export-full-txt' },
          ],
        },
        {
          label: t('chat.exportCompressed'),
          key: 'export-compressed',
          children: [
            { label: 'JSON', key: 'export-compressed-json' },
            { label: 'TXT', key: 'export-compressed-txt' },
          ],
        },
      ],
    })
  }

  if (to) {
    options.push(
      { label: t('chat.openSessionInNewTab'), key: 'open-link' },
      { label: t('chat.copySessionLink'), key: 'copy-link' },
    )
  }

  options.push({ label: t('chat.copySessionId'), key: 'copy-id' })

  if (canDelete) {
    options.push({ label: t('common.delete'), key: 'delete', danger: true })
  }

  return options
}

export function promptSessionDelete(
  dialog: SessionDeleteDialog,
  t: SessionActionTranslator,
  sessionTitle: string,
  onPositiveClick: () => void | Promise<void>,
) {
  dialog.warning({
    title: sessionTitle,
    content: () => h(
      'span',
      { style: 'color: var(--error); font-weight: 600;' },
      t('common.delete'),
    ),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick,
  })
}
