import { nonemptyString, type OwnedCard } from '../cards'
import { getAccountId, onAccountChange } from './account'
import {
  getCollectionState,
  invalidateCollection,
  loadCollection,
  onCollectionChange,
  readCollectionJson,
  stopCollectionLoad,
} from './collection'
import { collectionCompatible, onCompatibilityChange } from './compatibility'
import { errorMessage } from './presentation'
import { requestWrite } from './requests'
import {
  buildSelection,
  type Commitments,
  defaultSelectionRules,
  type SelectionRules,
  selectionFingerprint,
} from './selection'

export const DISCARD_JOURNAL_PREFIX = 'wm_toolbox_discard_v1:'
type CopyResult = {
  copyId: string
  title: string
  status: 'pending' | 'discarded' | 'failed' | 'unknown'
  error?: string
}
type Review = {
  accountId: string
  collection: string
  commitments: string
  rules: string
  cards: OwnedCard[]
  checkedAt: number
}
type ActionState = {
  phase: 'idle' | 'checking' | 'review' | 'verifying' | 'running' | 'done'
  error: string | null
  total: number
  results: CopyResult[]
  stop: boolean
}
let rules = defaultSelectionRules()
let commitments: Commitments = { catalogueIds: new Set(), copyIds: new Set() }
let checkedAt = 0
let review: Review | null = null
let state: ActionState = {
  phase: 'idle',
  error: null,
  total: 0,
  results: [],
  stop: false,
}
let checking: AbortController | null = null
let epoch = 0
const listeners = new Set<() => void>()
let refreshGame: (() => void) | null = null
export function setDiscardRefreshCallback(callback: () => void): void {
  refreshGame = callback
}
export function onSelectionChange(listener: () => void): void {
  listeners.add(listener)
}
function notify(): void {
  for (const listener of listeners) listener()
}
function rulesKey(): string {
  return JSON.stringify([
    [...rules.rarities].sort(),
    [...rules.added].sort(),
    [...rules.removed].sort(),
    rules.protect,
    rules.keep,
  ])
}
function commitmentsKey(value: Commitments): string {
  return JSON.stringify([
    [...value.catalogueIds].sort(),
    [...value.copyIds].sort(),
  ])
}
function busy(): boolean {
  return ['checking', 'verifying', 'running'].includes(state.phase)
}
function clearReview(): void {
  review = null
  if (state.phase === 'review') state.phase = 'idle'
}
export function getSelectionState() {
  const collection = getCollectionState()
  const ready =
    collection.status === 'complete' &&
    checkedAt > 0 &&
    Date.now() - checkedAt < 5 * 60_000
  return {
    ...state,
    results: [...state.results],
    rules,
    ready,
    reviewed: !!review && ready,
    plan: buildSelection(collection.cards, rules, commitments),
    commitments,
  }
}
export function editSelection(edit: (value: SelectionRules) => void): void {
  if (busy()) return
  edit(rules)
  clearReview()
  state.error = null
  notify()
}
export function resetSelection(): void {
  editSelection(value => {
    value.rarities.clear()
    value.added.clear()
    value.removed.clear()
  })
}
export function toggleCopy(copyId: string, selected: boolean): void {
  editSelection(value => {
    if (selected) {
      value.removed.delete(copyId)
      value.added.add(copyId)
    } else {
      value.added.delete(copyId)
      value.removed.add(copyId)
    }
  })
}

export function parseCommitments(
  market: Record<string, unknown>,
  trades: Record<string, unknown>,
  owner: string,
): Commitments {
  if (
    market.mine !== true ||
    !Array.isArray(market.selling) ||
    !Array.isArray(trades.trades)
  )
    throw new Error('Protections de vente / échange indisponibles')
  const result: Commitments = {
    catalogueIds: new Set(),
    copyIds: new Set(),
    saleCopyIds: new Set(),
    tradeCopyIds: new Set(),
  }
  for (const auction of market.selling) {
    if (!auction || typeof auction !== 'object')
      throw new Error('Protection de vente invalide')
    const copyId = nonemptyString(auction.user_card_id)
    const id =
      nonemptyString(auction.card_id) ?? nonemptyString(auction.card?.id)
    if (copyId) {
      result.copyIds.add(copyId)
      result.saleCopyIds?.add(copyId)
    } else if (id) result.catalogueIds.add(id)
    else throw new Error('Identité de vente indisponible')
  }
  // The native collection also protects trades at catalogue level, across copies.
  for (const trade of trades.trades) {
    if (!trade || typeof trade !== 'object' || typeof trade.status !== 'string')
      throw new Error('Protection d’échange invalide')
    if (trade.status !== 'pending') continue
    if (trade.initiator_id !== owner && trade.recipient_id !== owner)
      throw new Error('Compte d’échange modifié')
    if (!Array.isArray(trade.items))
      throw new Error('Cartes de l’échange indisponibles')
    for (const item of trade.items) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.offered_by !== 'string'
      )
        throw new Error('Identité d’échange indisponible')
      if (item.offered_by !== owner) continue
      const id = nonemptyString(item.card_id)
      if (!id) throw new Error('Identité d’échange indisponible')
      result.catalogueIds.add(id)
      const copyId = nonemptyString(item.user_card_id)
      if (copyId) result.tradeCopyIds?.add(copyId)
    }
  }
  return result
}
async function readCommitments(
  owner: string,
  signal: AbortSignal,
): Promise<Commitments> {
  const [market, trades] = await Promise.all([
    readCollectionJson('/api/marketplace?page=1&limit=1&mine=1', signal),
    readCollectionJson('/api/trades?active=1', signal),
  ])
  return parseCommitments(market, trades, owner)
}
export async function checkSelection(): Promise<void> {
  if (busy()) return
  const owner = getAccountId()
  if (!owner) return
  const current = ++epoch
  const request = new AbortController()
  checking = request
  state = { ...state, phase: 'checking', error: null, stop: false }
  clearReview()
  notify()
  try {
    await loadCollection(true)
    if (current !== epoch || request.signal.aborted) return
    if (getCollectionState().status !== 'complete')
      throw new Error('Chargez d’abord la collection complète')
    const fresh = await readCommitments(owner, request.signal)
    if (current !== epoch || getAccountId() !== owner || request.signal.aborted)
      return
    commitments = fresh
    checkedAt = Date.now()
    if (getCollectionState().status !== 'complete')
      throw new Error('Collection modifiée ; vérifiez à nouveau')
  } catch (cause) {
    if (current === epoch) {
      checkedAt = 0
      state.error = errorMessage(cause, 'Protections indisponibles')
    }
  } finally {
    if (current === epoch) {
      checking = null
      state.phase = state.results.length ? 'done' : 'idle'
      notify()
    }
  }
}
export function previewDiscard(): void {
  if (busy()) return
  const value = getSelectionState()
  const owner = getAccountId()
  if (!owner || !value.ready || !value.plan.cards.length) return
  review = {
    accountId: owner,
    collection: selectionFingerprint(getCollectionState().cards),
    commitments: commitmentsKey(commitments),
    rules: rulesKey(),
    cards: [...value.plan.cards],
    checkedAt: Date.now(),
  }
  state.phase = 'review'
  state.error = null
  notify()
}
export function cancelDiscard(): void {
  clearReview()
  notify()
}
export function stopDiscard(): void {
  state.stop = true
  checking?.abort()
  if (state.phase === 'checking' || state.phase === 'verifying')
    stopCollectionLoad()
  notify()
}
export function leaveCollection(): void {
  clearReview()
  if (busy()) stopDiscard()
}
function persistRun(owner: string, run: ActionState): boolean {
  try {
    localStorage.setItem(
      DISCARD_JOURNAL_PREFIX + owner,
      JSON.stringify({
        total: run.total,
        results: run.results.map(result =>
          result.status === 'pending'
            ? {
                ...result,
                status: 'unknown',
                error: 'Requête interrompue ; vérifiez la collection',
              }
            : result,
        ),
      }),
    )
    return true
  } catch {
    return false
  }
}
function restoreRun(): void {
  const owner = getAccountId()
  if (!owner) return
  try {
    const raw = localStorage.getItem(DISCARD_JOURNAL_PREFIX + owner)
    const saved = raw ? JSON.parse(raw) : null
    if (
      !Number.isSafeInteger(saved?.total) ||
      saved.total < 0 ||
      !Array.isArray(saved.results) ||
      saved.results.length > saved.total
    )
      return
    if (
      !saved.results.every(
        (entry: CopyResult) =>
          entry &&
          typeof entry.copyId === 'string' &&
          typeof entry.title === 'string' &&
          ['discarded', 'failed', 'unknown'].includes(entry.status) &&
          (entry.error === undefined || typeof entry.error === 'string'),
      )
    )
      return
    state = {
      phase: 'done',
      error: null,
      total: saved.total,
      results: saved.results,
      stop: false,
    }
  } catch {
    /* Ignore an invalid journal. */
  }
}
onAccountChange(() => {
  epoch++
  checking?.abort()
  checking = null
  state.stop = true
  state = { phase: 'idle', error: null, total: 0, results: [], stop: false }
  rules = defaultSelectionRules()
  commitments = { catalogueIds: new Set(), copyIds: new Set() }
  checkedAt = 0
  review = null
  restoreRun()
  notify()
})
onCompatibilityChange(() => {
  if (collectionCompatible()) return
  checkedAt = 0
  clearReview()
  if (state.phase === 'running' || state.phase === 'verifying')
    state.stop = true
  notify()
})
onCollectionChange(() => {
  checkedAt = 0
  // A native mutation or another tab's refresh during execution stops subsequent writes.
  if (state.phase === 'running') state.stop = true
  clearReview()
  notify()
})

export function parseDiscardResult(json: unknown): {
  status: 'discarded' | 'failed' | 'unknown'
  error?: string
} {
  if (!json || typeof json !== 'object')
    return { status: 'unknown', error: 'Résultat indisponible' }
  const value = json as Record<string, unknown>
  if (
    value.discarded_count === 1 &&
    (value.failed === undefined ||
      (Array.isArray(value.failed) && value.failed.length === 0))
  )
    return { status: 'discarded' }
  if (
    value.discarded_count === 0 &&
    Array.isArray(value.failed) &&
    value.failed.length === 1
  ) {
    const entry = value.failed[0]
    const message =
      typeof entry === 'string'
        ? entry
        : (nonemptyString(entry?.error) ?? nonemptyString(entry?.reason))
    return { status: 'failed', error: message ?? 'Refusé par le jeu' }
  }
  return {
    status: 'unknown',
    error: 'Résultat inattendu ; vérifiez la collection avant une autre action',
  }
}

export async function executeDiscard(): Promise<void> {
  const approved = review
  if (
    !approved ||
    busy() ||
    approved.accountId !== getAccountId() ||
    approved.rules !== rulesKey() ||
    Date.now() - approved.checkedAt > 60_000
  ) {
    clearReview()
    notify()
    return
  }
  if (!navigator.locks) {
    state.error =
      'Les actions groupées nécessitent le verrouillage entre onglets'
    notify()
    return
  }
  await navigator.locks.request(
    `wm-toolbox-collection-action:${approved.accountId}`,
    { ifAvailable: true },
    async lock => {
      if (!lock) {
        state.error = 'Une action est déjà en cours dans un autre onglet'
        notify()
        return
      }
      if (
        review !== approved ||
        getAccountId() !== approved.accountId ||
        busy()
      )
        return
      const current = ++epoch
      const run: ActionState = {
        phase: 'verifying',
        error: null,
        total: approved.cards.length,
        results: [],
        stop: false,
      }
      state = run
      review = null
      const request = new AbortController()
      checking = request
      notify()
      let attempted = false
      try {
        // Revalidate the full collection and protections after the user's confirmation.
        await loadCollection(true)
        if (current !== epoch || run.stop) return
        if (
          getCollectionState().status !== 'complete' ||
          selectionFingerprint(getCollectionState().cards) !==
            approved.collection
        )
          throw new Error('Collection modifiée ; préparez un nouvel aperçu')
        const fresh = await readCommitments(approved.accountId, request.signal)
        if (current !== epoch || run.stop) return
        if (
          commitmentsKey(fresh) !== approved.commitments ||
          rulesKey() !== approved.rules
        )
          throw new Error('Protections modifiées ; préparez un nouvel aperçu')
        commitments = fresh
        checkedAt = Date.now()
        run.phase = 'running'
        checking = null
        notify()
        for (const card of approved.cards) {
          if (
            run.stop ||
            current !== epoch ||
            getAccountId() !== approved.accountId
          )
            break
          // One identified copy per native bulk request: partial results stay attributable.
          // Never retry a write. Stopping waits for its response before ending the run.
          const result: CopyResult = {
            copyId: card.copyId,
            title: card.title,
            status: 'pending',
          }
          run.results.push(result)
          if (!persistRun(approved.accountId, run)) {
            run.results.pop()
            run.error =
              'Action arrêtée : impossible d’enregistrer le résultat localement'
            run.stop = true
            break
          }
          attempted = true
          const timeout = new AbortController()
          const timer = setTimeout(() => timeout.abort(), 20_000)
          try {
            const { response, json } = await requestWrite(
              '/api/user-cards/bulk-discard',
              timeout.signal,
              {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card_ids: [card.copyId] }),
              },
            )
            const outcome = response.ok
              ? parseDiscardResult(json)
              : {
                  status: 'unknown' as const,
                  error: `HTTP ${response.status} ; vérifiez la collection`,
                }
            Object.assign(result, outcome)
            if (outcome.status === 'discarded') delete result.error
            if (outcome.status === 'unknown') run.stop = true
          } catch {
            result.status = 'unknown'
            result.error = 'Résultat incertain ; vérifiez la collection'
            run.stop = true
          } finally {
            clearTimeout(timer)
            if (!persistRun(approved.accountId, run)) {
              run.error =
                'Action arrêtée : impossible d’enregistrer le résultat localement'
              run.stop = true
            }
            if (current === epoch) notify()
          }
          if (!run.stop) await new Promise(resolve => setTimeout(resolve, 350))
        }
      } catch (cause) {
        run.error = errorMessage(cause, 'Action indisponible')
      } finally {
        if (current === epoch) {
          checking = null
          run.phase = 'done'
          persistRun(approved.accountId, run)
          if (attempted) invalidateCollection()
          notify()
          if (attempted && refreshGame) {
            setTimeout(() => {
              if (current === epoch && getAccountId() === approved.accountId)
                refreshGame?.()
            }, 1500)
          }
        }
      }
    },
  )
}
