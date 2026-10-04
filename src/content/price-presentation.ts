import { formatDateTime } from './date-format'
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

export function priceCheckDate(fetchedAt: number): string {
  return formatDateTime(fetchedAt)
}

type PricePresentation = {
  status: PriceQuote['status'] | 'unknown-variant'
  value: string
  age: string
  hint: string
}

export function presentPrice(
  quote: PriceQuote,
  context: PriceContext = 'album',
  shiny = false,
): PricePresentation {
  if (shiny)
    return {
      status: 'unknown-variant',
      value: '—',
      age: '',
      hint: 'Prix des brillantes inconnu · la moyenne native ne distingue pas cette variante',
    }
  if (quote.status === 'loading')
    return {
      status: 'loading',
      value: 'Chargement',
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

/** Visible alongside the reference; a failed attempt never changes its reading date. */
export function priceFreshness(
  quote: PriceQuote,
  context: PriceContext,
): { text: string; warning: boolean } {
  const threshold = context === 'decision' ? 'Seuil 15 min' : 'Cache 24 h'
  if (quote.status === 'loading')
    return { text: `${threshold} · lecture en cours`, warning: false }
  if (quote.status === 'unavailable' || quote.status === 'not-found')
    return {
      text: `${threshold} · ${quote.status === 'not-found' ? 'Carte introuvable' : 'Lecture indisponible'} · tentative ${priceCheckDate(quote.fetchedAt)}${quote.status === 'unavailable' && quote.reason ? ` · ${quote.reason}` : ''}`,
      warning: true,
    }
  if (quote.status === 'unknown-rarity')
    return { text: `${threshold} · rareté inconnue`, warning: true }
  const old = priceTooOld(quote, context)
  return {
    text: `Lu le ${priceCheckDate(quote.fetchedAt)} · ${threshold} · ${old ? 'à actualiser' : 'récent'}${quote.failed ? ` · Actualisation échouée le ${priceCheckDate(quote.lastAttempt ?? quote.fetchedAt)} · ancienne référence conservée` : ''}`,
    warning: old || !!quote.failed,
  }
}
