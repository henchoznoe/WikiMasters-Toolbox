import { cancelDiscard, leaveCollection } from './collection-actions'
import { clearOpenAllConfirmation, leavePacksPage } from './packs'
import { createPacksBody, mountPacksBody } from './packs-panel'
import type { ToolboxPage } from './panel'

export const toolboxPages: readonly ToolboxPage[] = [
  {
    id: 'collection',
    label: 'Collection',
    matches: path => /^\/collection(\/|$)/.test(path),
    createBody: createCollectionBody,
    onMount: mountCollectionBody,
    onHide: cancelDiscard,
    onUnmount: leaveCollection,
  },
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

import { createCollectionBody, mountCollectionBody } from './collection-panel'
