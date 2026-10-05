import { resolvePageAdapter } from './page-adapters'
import type { ToolboxPage } from './panel'
import { createPricesBody, renderPricePanel } from './price-panel'
import { cancelPriceBatch } from './price-store'
import { leavePulls } from './pulls-observer'
import { createPullsBody, renderPullsPanel } from './pulls-panel'

export const toolboxPages: readonly ToolboxPage[] = [
  {
    id: 'pulls',
    label: 'Paquets',
    matches: (path: string) => /^\/pulls\/?$/.test(path),
    createBody: createPullsBody,
    onMount: renderPullsPanel,
    onHide: cancelPriceBatch,
    onUnmount: leavePulls,
  },
  ...[
    ['collection', 'Collection'],
    ['market', 'Marché'],
    ['catalogue', 'Catalogue'],
    ['trades', 'Échanges'],
  ].map(([id, label]) => ({
    id,
    label,
    matches: (path: string) => resolvePageAdapter(path)?.id === id,
    createBody: createPricesBody,
    onMount: renderPricePanel,
    onHide: cancelPriceBatch,
    onUnmount: cancelPriceBatch,
  })),
]
