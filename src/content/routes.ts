import { cancelDiscard, leaveCollection } from './collection-actions'
import { createCompactControls } from './collection-browser'
import {
  createMarketBody,
  renderMarketPanel,
  resetMarketPanel,
} from './market-panel'
import { cancelMarketReads } from './market-store'
import { clearOpenAllConfirmation, leavePacksPage } from './packs'
import { createPacksBody, mountPacksBody } from './packs-panel'
import { resolvePageAdapter } from './page-adapters'
import type { ToolboxPage } from './panel'
import {
  createPriceControls,
  createPricesBody,
  renderPricePanel,
} from './price-panel'
import { cancelPriceBatch } from './price-store'
import { hydrateRoute } from './prices'
import { leaveMarket } from './sale'

export const toolboxPages: readonly ToolboxPage[] = [
  {
    id: 'collection',
    label: 'Collection',
    matches: path => resolvePageAdapter(path)?.id === 'collection',
    read: hydrateRoute,
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
    matches: path => resolvePageAdapter(path)?.id === 'market',
    read: hydrateRoute,
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
    matches: path => resolvePageAdapter(path)?.id === 'packs',
    read: hydrateRoute,
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
    id: 'catalogue',
    label: 'Catalogue',
    matches: path => resolvePageAdapter(path)?.id === 'catalogue',
    read: hydrateRoute,
    createBody: () => {
      const body = createPricesBody()
      body.prepend(createCompactControls())
      return body
    },
    onMount: renderPricePanel,
    onUnmount: cancelPriceBatch,
  },
  {
    id: 'trades',
    label: 'Trades',
    matches: path => resolvePageAdapter(path)?.id === 'trades',
    read: hydrateRoute,
    createBody: createPricesBody,
    onMount: renderPricePanel,
    onUnmount: cancelPriceBatch,
  },
]

import { createCollectionBody, mountCollectionBody } from './collection-panel'
