import { type Card, mapCard } from './cards'
import { mapPriceListing } from './content/price-comparison'
import type { PullCard } from './content/pulls-model'
import { saleSample } from './content/sales-model'

const networkWindow = window as Window & {
  __wmToolboxNetworkInstalled?: boolean
}
let accountId: string | null = null
let accountEpoch = 0
let allowCollectionAccount = true

const incompatibleSources = new Set<string>()
function compatibility(source: string, ok: boolean): void {
  if (ok && !incompatibleSources.has(source)) return
  if (ok) incompatibleSources.delete(source)
  else incompatibleSources.add(source)
  emit({ kind: 'compatibility', source, compatible: ok, accountId })
}

function emit(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new CustomEvent('wm-toolbox:data', {
      detail: JSON.stringify(data),
    }),
  )
}
function accountIdFromProfileUrl(url: URL): string | null {
  // Only the ID is used; ignore the other columns in the native profile lookup.
  if (
    !url.hostname.endsWith('.supabase.co') ||
    url.pathname !== '/rest/v1/profiles' ||
    url.searchParams.get('select')?.split(',')[0]?.trim() !== 'id'
  )
    return null
  return (
    /^eq\.([0-9a-f-]{36})$/i
      .exec(url.searchParams.get('id') || '')?.[1]
      ?.toLowerCase() ?? null
  )
}

function setAccount(id: string | null): void {
  if (id !== accountId) {
    accountId = id
    if (id) allowCollectionAccount = true
    accountEpoch += 1
  }
  emit({ kind: 'account', accountId })
}

function inspect(url: URL, json: unknown, epoch: number): void {
  // Discard a response that started under a previous login.
  if (epoch !== accountEpoch) return
  if (
    url.hostname.endsWith('.supabase.co') &&
    url.pathname === '/auth/v1/logout'
  ) {
    setAccount(null)
    return
  }
  const profileId = accountIdFromProfileUrl(url)
  if (profileId) {
    const profiles = Array.isArray(json) ? json : [json]
    if (
      profiles.some(
        row => row && typeof row === 'object' && row.id === profileId,
      )
    )
      setAccount(profileId)
    return
  }
  if (
    url.hostname.endsWith('.supabase.co') &&
    url.pathname === '/rest/v1/rpc/get_my_profile'
  ) {
    const profile = Array.isArray(json) ? json[0] : json
    const id = profile && typeof profile === 'object' ? profile.id : null
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
      setAccount(id.toLowerCase())
    return
  }
  if (url.origin !== location.origin) return
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    if (url.pathname === '/api/my-collection')
      compatibility('collection', false)
    else if (url.pathname === '/api/cards') compatibility('catalogue', false)
    else if (url.pathname === '/api/trades') compatibility('trades', false)
    return
  }
  const data = json as Record<string, unknown>
  if (url.pathname === '/api/packs/open') {
    const raw = Array.isArray(data.cards) ? data.cards : []
    const cards = raw.map(row => {
      const identity = mapCard(row, true)
      if (!identity) return null
      const entry = row as Record<string, unknown>
      const source =
        entry.card && typeof entry.card === 'object'
          ? (entry.card as Record<string, unknown>)
          : entry
      const shiny =
        typeof entry.is_shiny === 'boolean'
          ? entry.is_shiny
          : typeof source.is_shiny === 'boolean'
            ? source.is_shiny
            : null
      return {
        catalogueId: identity.id,
        title: identity.title,
        rarity: identity.rarity,
        shiny,
      } satisfies PullCard
    })
    compatibility('pulls', raw.length === 5 && cards.every(Boolean))
    if (raw.length === 5 && cards.every(Boolean))
      emit({ kind: 'pull-result', accountId, id: crypto.randomUUID(), cards })
    return
  }
  if (
    url.pathname === '/api/marketplace' ||
    /^\/api\/marketplace\/[0-9a-f-]{36}$/i.test(url.pathname)
  ) {
    const rows = [
      ...(Array.isArray(data.history) ? data.history : []),
      ...(Array.isArray(data.auctions) ? data.auctions : []),
      ...(data.auction ? [data.auction] : []),
    ]
    const samples = rows
      .slice(0, 1000)
      .map(row => saleSample(row))
      .filter(Boolean)
    if (samples.length) emit({ kind: 'sale-samples', accountId, samples })
    const listings = rows.slice(0, 500).map(mapPriceListing).filter(Boolean)
    if (listings.length) emit({ kind: 'price-listings', accountId, listings })
  }
  let kind: string | null = null
  let raw: unknown[] = []
  if (
    url.pathname === '/api/my-collection' &&
    url.searchParams.has('owned_by') &&
    Array.isArray(data.collection)
  ) {
    kind = 'peer-collection'
    raw = data.collection
  } else if (
    url.pathname === '/api/my-collection' &&
    Array.isArray(data.collection)
  ) {
    kind = 'collection'
    raw = data.collection
    const owners = new Set(
      raw.flatMap(row => {
        if (!row || typeof row !== 'object') return []
        const owner = (row as Record<string, unknown>).user_id
        return typeof owner === 'string' ? [owner.toLowerCase()] : []
      }),
    )
    if (
      owners.size === 1 &&
      !accountId &&
      allowCollectionAccount &&
      /^[0-9a-f-]{36}$/i.test([...owners][0])
    )
      setAccount([...owners][0])
    if (
      owners.size > 1 ||
      (owners.size === 1 && !owners.has(accountId as string))
    )
      return
  } else if (url.pathname === '/api/trades' && Array.isArray(data.trades)) {
    kind = 'trades'
    raw = data.trades.flatMap(trade =>
      Array.isArray(trade?.items) ? trade.items : [],
    )
  } else if (
    /^\/api\/profile\/[^/]+\/collection$/.test(url.pathname) &&
    Array.isArray(data.collection)
  ) {
    kind = 'peer-collection'
    raw = data.collection
  } else if (url.pathname === '/api/cards' && Array.isArray(data.cards)) {
    kind = 'catalogue'
    raw = data.cards
  } else if (
    url.pathname === '/api/marketplace' &&
    Array.isArray(data.auctions)
  ) {
    kind = 'market-list'
    raw = data.auctions
  } else if (/^\/api\/marketplace\/[0-9a-f-]{36}$/i.test(url.pathname)) {
    kind = 'marketplace'
    raw = [data.auction]
  }
  if (
    !kind &&
    !url.search &&
    ['/api/my-collection', '/api/cards', '/api/trades'].includes(url.pathname)
  ) {
    compatibility(
      url.pathname === '/api/my-collection'
        ? 'collection'
        : url.pathname === '/api/cards'
          ? 'catalogue'
          : url.pathname === '/api/trades'
            ? 'trades'
            : 'catalogue',
      false,
    )
    return
  }
  if (kind) {
    const mapped = raw.map(row => mapCard(row, kind === 'collection'))
    if (mapped.some(card => !card)) {
      compatibility(kind, false)
      return
    }
    compatibility(kind, true)
    emit({ kind, cards: mapped as Card[], accountId })
  }
}

function isRelevant(url: URL, method: string): boolean {
  // Native authentication responses establish scope; no credentials are read.
  if (url.hostname.endsWith('.supabase.co'))
    return (
      Boolean(accountIdFromProfileUrl(url)) ||
      url.pathname === '/auth/v1/logout' ||
      url.pathname === '/rest/v1/rpc/get_my_profile'
    )
  if (
    url.origin === location.origin &&
    url.pathname === '/api/packs/open' &&
    method.toUpperCase() === 'POST'
  )
    return true
  if (method.toUpperCase() !== 'GET' || url.origin !== location.origin)
    return false
  return (
    [
      '/api/trades',
      '/api/cards',
      '/api/marketplace',
      '/api/my-collection',
    ].includes(url.pathname) ||
    /^\/api\/profile\/[^/]+\/collection$/.test(url.pathname) ||
    /^\/api\/marketplace\/[0-9a-f-]{36}$/i.test(url.pathname)
  )
}

if (!networkWindow.__wmToolboxNetworkInstalled) {
  networkWindow.__wmToolboxNetworkInstalled = true
  function inspectAccountRequest(url: URL): void {
    if (
      url.hostname.endsWith('.supabase.co') &&
      (url.pathname === '/auth/v1/logout' ||
        (url.pathname === '/auth/v1/token' &&
          url.searchParams.get('grant_type') !== 'refresh_token'))
    ) {
      allowCollectionAccount = false
      accountEpoch += 1
      incompatibleSources.clear()
      setAccount(null)
    }
    const profile = accountIdFromProfileUrl(url)
    if (profile && accountId && profile !== accountId) setAccount(null)
  }
  const originalFetch = window.fetch.bind(window)
  window.fetch = (
    ...args: Parameters<typeof fetch>
  ): ReturnType<typeof fetch> => {
    const input = args[0]
    let url: URL
    try {
      url = new URL(
        input instanceof Request ? input.url : String(input),
        location.origin,
      )
    } catch {
      return originalFetch(...args)
    }
    inspectAccountRequest(url)
    const promise = originalFetch(...args)
    const method =
      args[1]?.method ?? (input instanceof Request ? input.method : 'GET')
    const epoch = accountEpoch
    if (isRelevant(url, method)) {
      void promise
        .then(async response => {
          if (
            (response.status === 401 || response.status === 403) &&
            url.origin === location.origin
          ) {
            if (epoch === accountEpoch) setAccount(null)
            return
          }
          if (response.ok)
            inspect(
              url,
              await response
                .clone()
                .json()
                .catch(() => null),
              epoch,
            )
        })
        .catch(() => {
          /* Leave the game's request and response intact. */
        })
    }
    return promise
  }

  const requests = new WeakMap<
    XMLHttpRequest,
    { url: URL; method: string; epoch: number }
  >()
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async = true,
    user?: string,
    password?: string,
  ): void {
    Reflect.apply(originalOpen, this, [method, url, async, user, password])
    try {
      requests.set(this, {
        url: new URL(String(url), location.origin),
        method,
        epoch: accountEpoch,
      })
    } catch {
      requests.delete(this)
    }
  }
  XMLHttpRequest.prototype.send = function (
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const request = requests.get(this)
    if (request && isRelevant(request.url, request.method)) {
      inspectAccountRequest(request.url)
      request.epoch = accountEpoch
      this.addEventListener(
        'load',
        () => {
          if (
            (this.status === 401 || this.status === 403) &&
            request.url.origin === location.origin
          ) {
            if (request.epoch === accountEpoch) setAccount(null)
            return
          }
          if (this.status < 200 || this.status >= 300) return
          try {
            inspect(
              request.url,
              this.responseType === 'json'
                ? this.response
                : JSON.parse(this.responseText || 'null'),
              request.epoch,
            )
          } catch {
            /* Non-JSON response. */
          }
        },
        { once: true },
      )
    }
    originalSend.call(this, body)
  }
}
