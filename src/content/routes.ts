import { cancelDiscard, leaveCollection } from './collection-actions'
import {
  createMarketBody,
  renderMarketPanel,
  resetMarketPanel,
} from './market-panel'
import { cancelMarketReads } from './market-store'
import { clearOpenAllConfirmation, leavePacksPage } from './packs'
import { createPacksBody, mountPacksBody } from './packs-panel'
import type { ToolboxPage } from './panel'
import {
  createPriceControls,
  createPricesBody,
  renderPricePanel,
} from './price-panel'
import { cancelPriceBatch } from './price-store'
import { leaveMarket } from './sale'

export const toolboxPages: readonly ToolboxPage[] = [
  {
    id: 'collection',
    label: 'Collection',
    matches: path => /^\/collection(\/|$)/.test(path),
    createBody: createCollectionBody,
    onMount: mountCollectionBody,
    onHide: cancelDiscard,
    onUnmount: () => {
      leaveCollection()
      cancelMarketReads()
      leaveMarket()
      resetMarketPanel()
    },
  },
  {
    id: 'market',
    label: 'Market',
    matches: path => /^\/marketplace(\/|$)/.test(path),
    createBody: createMarketBody,
    onMount: renderMarketPanel,
    onUnmount: () => {
      cancelPriceBatch()
      cancelMarketReads()
      leaveMarket()
      resetMarketPanel()
    },
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
    matches: path => /^\/(global-collection|trades)(\/|$)/.test(path),
    createBody: createPricesBody,
    onMount: renderPricePanel,
    onUnmount: cancelPriceBatch,
  },
]

import { createCollectionBody, mountCollectionBody } from './collection-panel'
