import { type Card, mapCard } from './cards'
import { mapAuction } from './content/market-model'
import { installNativeMarket } from './native-market'

const networkWindow = window as Window & {
  __wmToolboxNetworkInstalled?: boolean
}
let accountId: string | null = null
let accountEpoch = 0

function emit(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new CustomEvent('wm-toolbox:data', {
      detail: JSON.stringify(data),
    }),
  )
}
function failedSale(url: URL, method: string, epoch: number, status = 0): void {
  if (
    url.origin === location.origin &&
    url.pathname === '/api/marketplace' &&
    method.toUpperCase() === 'POST' &&
    epoch === accountEpoch
  )
    emit({
      kind: 'sale-result',
      accountId,
      status: status >= 400 && status < 500 ? 'rejected' : 'unknown',
    })
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
    accountEpoch += 1
  }
  emit({ kind: 'account', accountId })
}

function isMutation(url: URL, method: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false
  if (url.origin === location.origin)
    return (
      url.pathname === '/api/packs/open' ||
      /^\/api\/user-cards\//.test(url.pathname) ||
      /^\/api\/(trades|marketplace)(\/|$)/.test(url.pathname)
    )
  return (
    url.hostname.endsWith('.supabase.co') &&
    /^\/rest\/v1\/(user_cards|user_card_tags|trades)(\/|$)/.test(url.pathname)
  )
}

function inspect(url: URL, method: string, json: unknown, epoch: number): void {
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
  if (isMutation(url, method)) {
    if (
      url.pathname === '/api/marketplace' &&
      method.toUpperCase() === 'POST'
    ) {
      const result = json as Record<string, unknown> | null
      emit({
        kind: 'sale-result',
        accountId,
        status: typeof result?.auction_id === 'string' ? 'listed' : 'unknown',
        auctionId: result?.auction_id,
      })
    }
    emit({ kind: 'collection-changed', accountId })
  }
  if (!json || typeof json !== 'object' || url.origin !== location.origin)
    return
  const data = json as Record<string, unknown>
  if (
    url.pathname === '/api/marketplace' &&
    data.mine === true &&
    Array.isArray(data.selling) &&
    Array.isArray(data.history)
  ) {
    emit({
      kind: 'market-sales',
      accountId,
      selling: data.selling.map(mapAuction).filter(Boolean),
      history: data.history.map(mapAuction).filter(Boolean),
    })
  }
  if (
    url.pathname === '/api/my-collection/stats' &&
    !['q', 'rarity', 'tag_id', 'untagged', 'wishlisted_by'].some(key =>
      url.searchParams.has(key),
    )
  ) {
    emit({ kind: 'collection-total', accountId, total: data.total })
    return
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
    if (owners.size === 1 && !accountId) setAccount([...owners][0])
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
  } else if (url.pathname === '/api/packs/open' && Array.isArray(data.cards)) {
    kind = 'pack'
    raw = data.cards
  }
  if (kind) {
    const cards = raw
      .map(row => mapCard(row, kind === 'collection' || kind === 'pack'))
      .filter((card): card is Card => card !== null)
    emit({ kind, cards, accountId })
  }
}

function isRelevant(url: URL, method: string): boolean {
  return (
    Boolean(accountIdFromProfileUrl(url)) ||
    (url.hostname.endsWith('.supabase.co') &&
      (url.pathname === '/auth/v1/logout' ||
        url.pathname === '/rest/v1/rpc/get_my_profile')) ||
    isMutation(url, method) ||
    (url.origin === location.origin &&
      (url.pathname === '/api/trades' ||
        /^\/api\/profile\/[^/]+\/collection$/.test(url.pathname) ||
        url.pathname === '/api/cards' ||
        url.pathname === '/api/marketplace' ||
        url.pathname === '/api/my-collection' ||
        url.pathname === '/api/my-collection/stats' ||
        /^\/api\/marketplace\/[0-9a-f-]{36}$/i.test(url.pathname)))
  )
}

function inspectPackVerification(url: URL, json: unknown, epoch: number): void {
  if (
    epoch === accountEpoch &&
    url.origin === location.origin &&
    url.pathname === '/api/packs/open' &&
    json &&
    typeof json === 'object' &&
    (json as Record<string, unknown>).human_verification_required === true
  )
    emit({ kind: 'pack-verification-required', accountId })
}

if (!networkWindow.__wmToolboxNetworkInstalled) {
  networkWindow.__wmToolboxNetworkInstalled = true
  installNativeMarket(() => accountId, emit)
  const originalFetch = window.fetch.bind(window)
  window.fetch = (
    ...args: Parameters<typeof fetch>
  ): ReturnType<typeof fetch> => {
    const promise = originalFetch(...args)
    const input = args[0]
    let url: URL
    try {
      url = new URL(
        input instanceof Request ? input.url : String(input),
        location.origin,
      )
    } catch {
      return promise
    }
    const method =
      args[1]?.method ?? (input instanceof Request ? input.method : 'GET')
    const epoch = accountEpoch
    if (isRelevant(url, method)) {
      void promise
        .then(async response => {
          if (response.status === 401 && url.origin === location.origin) {
            failedSale(url, method, epoch, response.status)
            if (epoch === accountEpoch) setAccount(null)
            return
          }
          if (response.ok) {
            const json = await response
              .clone()
              .json()
              .catch(() => null)
            inspect(url, method, json, epoch)
          } else if (
            url.origin === location.origin &&
            url.pathname === '/api/packs/open'
          ) {
            inspectPackVerification(
              url,
              await response
                .clone()
                .json()
                .catch(() => null),
              epoch,
            )
            if (response.status >= 500 && epoch === accountEpoch)
              emit({ kind: 'collection-changed', accountId })
          } else if (
            response.status >= 500 &&
            isMutation(url, method) &&
            epoch === accountEpoch
          ) {
            emit({ kind: 'collection-changed', accountId })
          }
          if (!response.ok) failedSale(url, method, epoch, response.status)
        })
        .catch(() => {
          failedSale(url, method, epoch)
          /* Leave the game's response untouched. */
          if (isMutation(url, method) && epoch === accountEpoch)
            emit({ kind: 'collection-changed', accountId })
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
      request.epoch = accountEpoch
      this.addEventListener(
        'load',
        () => {
          if (this.status === 401 && request.url.origin === location.origin) {
            failedSale(request.url, request.method, request.epoch, this.status)
            if (request.epoch === accountEpoch) setAccount(null)
            return
          }
          if (
            this.status >= 500 &&
            isMutation(request.url, request.method) &&
            request.epoch === accountEpoch
          ) {
            emit({ kind: 'collection-changed', accountId })
          }
          if (this.status < 200 || this.status >= 300) {
            failedSale(request.url, request.method, request.epoch, this.status)
            try {
              inspectPackVerification(
                request.url,
                this.responseType === 'json'
                  ? this.response
                  : JSON.parse(this.responseText || 'null'),
                request.epoch,
              )
            } catch {
              /* Non-JSON response. */
            }
            return
          }
          try {
            inspect(
              request.url,
              request.method,
              this.responseType === 'json'
                ? this.response
                : JSON.parse(this.responseText || 'null'),
              request.epoch,
            )
          } catch {
            /* Non-JSON response. */
            if (
              isMutation(request.url, request.method) &&
              request.epoch === accountEpoch
            )
              emit({ kind: 'collection-changed', accountId })
          }
        },
        { once: true },
      )
    }
    originalSend.call(this, body)
  }
}
