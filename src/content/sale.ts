import { type Card, cardVariantKey } from '../cards'
import { getAccountId, onAccountChange } from './account'
import {
  getCollectionState,
  getOwnedCopy,
  loadCollection,
  onCollectionChange,
  stopCollectionLoad,
} from './collection'
import { getSelectionState, parseCommitments } from './collection-actions'
import { saleBlock } from './market-model'
import { chooseComparables } from './market-store'
import { requestMarketJson } from './price-store'
import { buildSelection } from './selection'
import { isCard } from './shared'

export const SALE_JOURNAL_PREFIX = 'wm_toolbox_sale_v1:'
let card: Card | null = null
let checkedUntil = 0
let approvedProtections = ''
function protectionKey(): string {
  const rules = getSelectionState().rules
  return JSON.stringify([rules.protect, rules.keep])
}
let busy = false
let submitted = false
let attempt: { owner: string; copyId: string } | null = null
let error: string | null = null
let release: (() => void) | null = null
let request: AbortController | null = null
let notify = (): void => {}
export function setSaleCallback(callback: () => void): void {
  notify = callback
}
export function nativeMarket(
  action: string,
  data: Record<string, unknown> = {},
): void {
  window.dispatchEvent(
    new CustomEvent('wm-toolbox:native-market', {
      detail: JSON.stringify({ action, accountId: getAccountId(), ...data }),
    }),
  )
}
export function getSaleState() {
  return { card, busy, submitted, checked: checkedUntil > Date.now(), error }
}
export function readSaleJournal(): {
  status: string
  auctionId: string | null
  at: number
} | null {
  const owner = getAccountId()
  if (!owner) return null
  try {
    const saved = JSON.parse(
      localStorage.getItem(SALE_JOURNAL_PREFIX + owner) ?? 'null',
    )
    if (
      !saved ||
      !['listed', 'rejected', 'unknown'].includes(saved.status) ||
      typeof saved.at !== 'number' ||
      !Number.isFinite(saved.at)
    )
      return null
    return {
      status: saved.status,
      at: saved.at,
      auctionId:
        typeof saved.auctionId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(saved.auctionId)
          ? saved.auctionId
          : null,
    }
  } catch {
    return null
  }
}
export function cancelSale(): void {
  if (busy) stopCollectionLoad()
  request?.abort()
  request = null
  checkedUntil = 0
  approvedProtections = ''
  busy = false
  if (!submitted || attempt?.owner !== getAccountId()) {
    release?.()
    release = null
  }
  nativeMarket('revoke')
}
export function leaveMarket(): void {
  cancelSale()
  card = null
  error = null
  submitted = attempt?.owner === getAccountId()
  notify()
}
onAccountChange(() => {
  attempt = null
  leaveMarket()
})
onCollectionChange(() => {
  if (!busy && checkedUntil) {
    cancelSale()
    notify()
  }
})
export function observeSaleCard(value: unknown): void {
  const next = isCard(value) && value.copyId ? value : null
  if (
    card?.copyId === next?.copyId &&
    (!card || !next || cardVariantKey(card) === cardVariantKey(next))
  )
    return
  cancelSale()
  card = next
  error = null
  submitted = attempt?.owner === getAccountId()
  if (next) chooseComparables(next)
  notify()
}
export function requireSaleCheck(): void {
  cancelSale()
  error = 'Check this copy before confirming in the game'
  notify()
}
export function inspectCopy(copyId: string): void {
  const copy = getCollectionState().cards.find(row => row.copyId === copyId)
  if (!copy) return
  nativeMarket('inspect', { copyId, title: copy.title })
}
export async function checkSale(acknowledge: boolean): Promise<void> {
  const expected = card
  const owner = getAccountId()
  if (!expected?.copyId || !owner || busy || submitted) return
  cancelSale()
  if (!navigator.locks) {
    error = 'Browser locking unavailable'
    notify()
    return
  }
  busy = true
  error = null
  const run = new AbortController()
  request = run
  notify()
  await navigator.locks.request(
    `wm-toolbox-collection-action:${owner}`,
    { ifAvailable: true },
    async lock => {
      if (!lock) {
        error = 'An action is running in another tab'
        busy = false
        notify()
        return
      }
      try {
        await loadCollection(true)
        if (run.signal.aborted || owner !== getAccountId() || card !== expected)
          return
        if (getCollectionState().status !== 'complete')
          throw new Error('Complete collection unavailable')
        const market = await requestMarketJson(
          '/api/marketplace?page=1&limit=1&mine=1',
          run.signal,
        )
        const trades = await requestMarketJson(
          '/api/trades?active=1',
          run.signal,
        )
        if (run.signal.aborted || owner !== getAccountId() || card !== expected)
          return
        const commitments = parseCommitments(market, trades, owner)
        const copy = getOwnedCopy(expected.copyId as string)
        const blocked = saleBlock(copy, owner, commitments)
        if (blocked) throw new Error(blocked)
        if (!copy || cardVariantKey(copy) !== cardVariantKey(expected))
          throw new Error('Copy changed')
        const rules = getSelectionState().rules
        const protectedReason = buildSelection(
          getCollectionState().cards,
          {
            ...rules,
            rarities: new Set(),
            added: new Set([copy.copyId]),
            removed: new Set(),
          },
          commitments,
        ).blocked.get(copy.copyId)
        if (protectedReason && !acknowledge)
          throw new Error(`${protectedReason} · acknowledge protection to sell`)
        checkedUntil = Date.now() + 30_000
        approvedProtections = protectionKey()
        nativeMarket('approve', { copyId: copy.copyId })
        busy = false
        notify()
        // Keep the same account lock until submission finishes, the dialog closes, or approval expires.
        await new Promise<void>(resolve => {
          release = resolve
          const timer = setTimeout(() => {
            resolve()
            if (!submitted) requireSaleCheck()
          }, 30_000)
          release = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      } catch (cause) {
        if (!run.signal.aborted)
          error = cause instanceof Error ? cause.message : 'Copy check failed'
      } finally {
        if (request === run) {
          request = null
          busy = false
          checkedUntil = 0
          nativeMarket('revoke')
          notify()
        }
      }
    },
  )
}
window.addEventListener('wm-toolbox:sale-submit', event => {
  const confirmation = event as CustomEvent<string>
  try {
    const data = JSON.parse(confirmation.detail)
    if (
      !card ||
      !isCard(data.card) ||
      data.accountId !== getAccountId() ||
      data.card?.copyId !== card.copyId ||
      cardVariantKey(data.card) !== cardVariantKey(card) ||
      !Number.isSafeInteger(data.amount) ||
      data.amount < 1 ||
      checkedUntil <= Date.now() ||
      approvedProtections !== protectionKey() ||
      submitted ||
      !release ||
      !getOwnedCopy(card.copyId as string)
    )
      throw new Error('Check again')
    // Saved as uncertain before allowing the game to send its write. Never auto-retry a native sale.
    localStorage.setItem(
      SALE_JOURNAL_PREFIX + getAccountId(),
      JSON.stringify({
        copyId: card.copyId,
        cardId: card.id,
        rarity: card.rarity,
        at: Date.now(),
        amount: data.amount,
        status: 'unknown',
      }),
    )
    submitted = true
    attempt = { owner: getAccountId() as string, copyId: card.copyId as string }
    checkedUntil = 0
    notify()
  } catch {
    confirmation.preventDefault()
    requireSaleCheck()
  }
})
export function observeSaleResult(status: unknown, auctionId: unknown): void {
  if (!attempt || attempt.owner !== getAccountId()) return
  try {
    const key = SALE_JOURNAL_PREFIX + getAccountId()
    const journal = JSON.parse(localStorage.getItem(key) ?? '{}')
    journal.status =
      status === 'listed'
        ? 'listed'
        : status === 'rejected'
          ? 'rejected'
          : 'unknown'
    journal.auctionId =
      typeof auctionId === 'string' && /^[0-9a-f-]{36}$/i.test(auctionId)
        ? auctionId
        : null
    localStorage.setItem(key, JSON.stringify(journal))
  } catch {
    /* The pre-submission journal already records uncertainty. */
  }
  error =
    status === 'listed'
      ? null
      : status === 'rejected'
        ? 'Game rejected the sale · check again'
        : 'Result uncertain · verify in My sales'
  submitted = false
  attempt = null
  cancelSale()
  notify()
}
export function stopSaleCheck(): void {
  if (busy) stopCollectionLoad()
  cancelSale()
  notify()
}
