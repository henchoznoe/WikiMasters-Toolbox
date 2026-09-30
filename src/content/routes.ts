import { clearOpenAllConfirmation, leavePacksPage } from './packs'
import { createPacksBody, mountPacksBody } from './packs-panel'
import type { ToolboxPage } from './panel'

export const toolboxPages: readonly ToolboxPage[] = [
  {
    id: 'packs',
    label: 'Packs',
    matches: path => /^\/pulls(\/|$)/.test(path),
    createBody: createPacksBody,
    onMount: mountPacksBody,
    onHide: clearOpenAllConfirmation,
    onUnmount: leavePacksPage,
  },
]
