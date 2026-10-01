import type { PriceQuote } from './price-store'

export function formatPriceAge(fetchedAt: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60_000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} j`
}

function priceCheckDate(fetchedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(fetchedAt))
}

type PricePresentation = {
  status: PriceQuote['status']
  value: string
  age: string
  hint: string
}

export function presentPrice(quote: PriceQuote): PricePresentation {
  if (quote.status === 'loading')
    return {
      status: 'loading',
      value: '…',
      age: '',
      hint: 'Loading average sale price',
    }
  const checked = priceCheckDate(quote.fetchedAt)
  if (quote.status === 'unavailable')
    return {
      status: quote.status,
      value: '!',
      age: '',
      hint: quote.reason
        ? `Price loading paused · ${quote.reason}`
        : `Price request failed · last attempt ${checked} · retry in one minute`,
    }
  if (quote.status === 'not-found')
    return {
      status: quote.status,
      value: '—',
      age: '',
      hint: `No market price found · last attempt ${checked} · retry in one minute`,
    }
  if (quote.status === 'unknown-rarity')
    return {
      status: quote.status,
      value: '—',
      age: formatPriceAge(quote.fetchedAt),
      hint: 'Card rarity unknown · no price inferred from another rarity',
    }
  const age = formatPriceAge(quote.fetchedAt)
  if (quote.status === 'no-sales')
    return {
      status: quote.status,
      value: quote.failed ? '!' : '—',
      age,
      hint: `No sales data for this rarity · checked ${checked}${quote.stale ? ' · stale observation' : ''}${quote.failed ? ` · refresh failed · last attempt ${priceCheckDate(quote.lastAttempt ?? quote.fetchedAt)}` : ''}`,
    }
  return {
    status: quote.status,
    value: `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(quote.average)} W${quote.failed ? ' !' : ''}`,
    age,
    hint: `Average sale price for this rarity · checked ${checked} · source period not specified by WikiMasters · average only · volume and dispersion unavailable${quote.stale ? ' · stale price' : ''}${quote.failed ? ` · refresh failed · last attempt ${priceCheckDate(quote.lastAttempt ?? quote.fetchedAt)}` : ''}`,
  }
}
