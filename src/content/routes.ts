import { resolvePageAdapter } from './page-adapters'
import type { ToolboxPage } from './panel'
import { createPricesBody, renderPricePanel } from './price-panel'
import { cancelPriceBatch } from './price-store'

export const toolboxPages: readonly ToolboxPage[] = [
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
}))
