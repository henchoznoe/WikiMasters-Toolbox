import { cancelDiscard, leaveCollection } from './collection-actions'
import { clearOpenAllConfirmation, leavePacksPage } from './packs'
import { createPacksBody, mountPacksBody } from './packs-panel'
import type { ToolboxPage } from './panel'
import {
  createPriceControls,
  createPricesBody,
  renderPricePanel,
} from './price-panel'
import { cancelPriceBatch } from './price-store'

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
    createBody: () => {
      const body = createPacksBody()
      body.append(createPriceControls())
      return body
    },
    onMount: mountPacksBody,
    onHide: clearOpenAllConfirmation,
    onUnmount: leavePacksPage,
  },
  {
    id: 'prices',
    label: 'Prices',
    matches: path =>
      /^\/(global-collection|marketplace|trades)(\/|$)/.test(path),
    createBody: createPricesBody,
    onMount: renderPricePanel,
    onUnmount: cancelPriceBatch,
  },
]

import { createCollectionBody, mountCollectionBody } from './collection-panel'
