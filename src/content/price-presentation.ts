import { type PriceContext, priceTooOld } from './price-context'
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
  return new Intl.DateTimeFormat('fr-FR', {
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

export function presentPrice(
  quote: PriceQuote,
  context: PriceContext = 'album',
): PricePresentation {
  if (quote.status === 'loading')
    return {
      status: 'loading',
      value: '…',
      age: '',
      hint: 'Chargement du prix moyen de vente',
    }
  const checked = priceCheckDate(quote.fetchedAt)
  if (quote.status === 'unavailable')
    return {
      status: quote.status,
      value: '!',
      age: '',
      hint: quote.reason
        ? `Chargement des prix suspendu · ${quote.reason}`
        : `Échec du chargement du prix · dernière tentative le ${checked} · réessayez dans une minute`,
    }
  if (quote.status === 'not-found')
    return {
      status: quote.status,
      value: '—',
      age: '',
      hint: `Aucun prix de marché trouvé · dernière tentative le ${checked} · réessayez dans une minute`,
    }
  if (quote.status === 'unknown-rarity')
    return {
      status: quote.status,
      value: '—',
      age: formatPriceAge(quote.fetchedAt),
      hint: 'Rareté de la carte inconnue · aucun prix déduit d’une autre rareté',
    }
  const age = formatPriceAge(quote.fetchedAt)
  const decisionOld = context === 'decision' && priceTooOld(quote, context)
  const decisionHint =
    context === 'decision'
      ? ` · fraîcheur vente / échange : 15 min${decisionOld ? ' · actualisez avant de décider' : ''}`
      : ''
  if (quote.status === 'no-sales')
    return {
      status: quote.status,
      value: quote.failed ? '!' : '—',
      age,
      hint: `Aucune donnée de vente pour cette rareté · vérifié le ${checked}${quote.stale ? ' · observation ancienne' : ''}${decisionHint}${quote.failed ? ` · actualisation échouée · dernière tentative le ${priceCheckDate(quote.lastAttempt ?? quote.fetchedAt)}` : ''}`,
    }
  return {
    status: quote.status,
    value: `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(quote.average)} W${quote.failed ? ' !' : decisionOld ? ' ↻' : ''}`,
    age,
    hint: `Prix moyen de vente pour cette rareté · vérifié le ${checked} · période de calcul non précisée par WikiMasters · moyenne seule · volume et dispersion indisponibles${quote.stale ? ' · prix ancien' : ''}${decisionHint}${quote.failed ? ` · actualisation échouée · dernière tentative le ${priceCheckDate(quote.lastAttempt ?? quote.fetchedAt)}` : ''}`,
  }
}
