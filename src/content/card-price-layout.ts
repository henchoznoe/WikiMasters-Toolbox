type Layout = {
  card: HTMLElement
  height: string
  nativeHeight: string
  contentRatio: number
}
const layouts = new Map<HTMLElement, Layout>()
let observer: ResizeObserver | null = null

function resize(host: HTMLElement, layout: Layout): void {
  const extra = Math.ceil((host.offsetHeight + 8) / layout.contentRatio)
  // Keep the native proportions and add enough room for the badge and bottom margin.
  layout.card.style.height = `calc(${layout.nativeHeight} + ${extra}px)`
}
export function releaseCardPriceSpace(host: HTMLElement): void {
  const layout = layouts.get(host)
  if (!layout) return
  observer?.unobserve(host)
  layout.card.style.height = layout.height
  layouts.delete(host)
}
export function pruneCardPriceLayouts(): void {
  for (const host of layouts.keys())
    if (!host.isConnected) releaseCardPriceSpace(host)
}
export function resetCardPriceLayouts(): void {
  for (const host of layouts.keys()) releaseCardPriceSpace(host)
  observer?.disconnect()
  observer = null
}
export function reserveCardPriceSpace(
  card: HTMLElement,
  host: HTMLElement,
): void {
  if (layouts.has(host)) return
  const body = card.querySelector('h3')?.parentElement
  const top = body?.className.match(/\btop-\[(\d+(?:\.\d+)?)%\]/)?.[1]
  const nativeHeight = card.className.match(/\bh-\[(clamp\([^\]]+\))\]/)?.[1]
  // Only modify the native responsive card layout that we can identify.
  if (!nativeHeight || !top || Number(top) >= 100) return
  const layout = {
    card,
    height: card.style.height,
    nativeHeight,
    contentRatio: 1 - Number(top) / 100,
  }
  layouts.set(host, layout)
  resize(host, layout)
  observer ??= new ResizeObserver(entries => {
    for (const entry of entries) {
      const layout = layouts.get(entry.target as HTMLElement)
      if (layout) resize(entry.target as HTMLElement, layout)
    }
  })
  observer.observe(host)
}
