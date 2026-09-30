const networkWindow = window as Window & {
  __wmToolboxNetworkInstalled?: boolean
}

type NetworkCard = { id: string; title: string; rarity: string | null }

function emit(
  kind: 'collection' | 'marketplace' | 'pack',
  cards: NetworkCard[],
): void {
  if (!cards.length) return
  window.dispatchEvent(
    new CustomEvent('wm-toolbox:data', {
      detail: JSON.stringify({ kind, cards }),
    }),
  )
}

function emitAccount(id: string): void {
  window.dispatchEvent(
    new CustomEvent('wm-toolbox:data', {
      detail: JSON.stringify({ kind: 'account', accountId: id }),
    }),
  )
}

function accountIdFromProfileUrl(url: URL): string | null {
  if (
    !url.hostname.endsWith('.supabase.co') ||
    url.pathname !== '/rest/v1/profiles' ||
    url.searchParams.get('select') !== 'id,is_pro'
  )
    return null
  const match = /^eq\.([0-9a-f-]{36})$/i.exec(url.searchParams.get('id') || '')
  return match?.[1] ?? null
}

function mapCard(raw: unknown): NetworkCard | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const source = (
    entry.card && typeof entry.card === 'object' ? entry.card : entry
  ) as Record<string, unknown>
  const id = entry.card_id || source.id
  const title = source.wikipedia_title
  if (typeof id !== 'string' || typeof title !== 'string') return null
  return {
    id,
    title,
    rarity:
      typeof entry.snapshot_rarity === 'string'
        ? entry.snapshot_rarity
        : typeof source.rarity === 'string'
          ? source.rarity
          : null,
  }
}

function inspect(url: string, json: unknown): void {
  const parsedUrl = new URL(url, location.origin)
  const accountId = accountIdFromProfileUrl(parsedUrl)
  if (accountId) {
    emitAccount(accountId)
    return
  }
  if (!json || typeof json !== 'object') return
  const pathname = parsedUrl.pathname
  const data = json as Record<string, unknown>
  if (pathname === '/api/my-collection' && Array.isArray(data.collection)) {
    emit(
      'collection',
      data.collection
        .map(mapCard)
        .filter((card): card is NetworkCard => card !== null),
    )
  } else if (/^\/api\/marketplace\/[0-9a-f-]{36}$/i.test(pathname)) {
    const auction = data.auction
    const card = mapCard(auction)
    if (card) emit('marketplace', [card])
  } else if (pathname === '/api/packs/open' && Array.isArray(data.cards)) {
    emit(
      'pack',
      data.cards
        .map(mapCard)
        .filter((card): card is NetworkCard => card !== null),
    )
  }
}

function isRelevant(url: string): boolean {
  try {
    const parsed = new URL(url, location.origin)
    if (accountIdFromProfileUrl(parsed)) return true
    return (
      parsed.origin === location.origin &&
      (parsed.pathname === '/api/my-collection' ||
        parsed.pathname === '/api/packs/open' ||
        /^\/api\/marketplace\/[0-9a-f-]{36}$/i.test(parsed.pathname))
    )
  } catch {
    return false
  }
}

if (!networkWindow.__wmToolboxNetworkInstalled) {
  networkWindow.__wmToolboxNetworkInstalled = true
  const originalFetch = window.fetch.bind(window)
  window.fetch = (
    ...args: Parameters<typeof fetch>
  ): ReturnType<typeof fetch> => {
    const promise = originalFetch(...args)
    const input = args[0]
    const url = input instanceof Request ? input.url : String(input)
    if (isRelevant(url)) {
      void promise
        .then(async response => {
          if (response.ok) inspect(url, await response.clone().json())
        })
        .catch(() => {
          /* Leave the game's response untouched. */
        })
    }
    return promise
  }

  const requestUrls = new WeakMap<XMLHttpRequest, string>()
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async = true,
    user?: string,
    password?: string,
  ): void {
    requestUrls.set(this, String(url))
    Reflect.apply(originalOpen, this, [method, url, async, user, password])
  }
  XMLHttpRequest.prototype.send = function (
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const url = requestUrls.get(this)
    if (url && isRelevant(url)) {
      this.addEventListener(
        'load',
        () => {
          if (this.status < 200 || this.status >= 300) return
          try {
            inspect(
              url,
              this.responseType === 'json'
                ? this.response
                : JSON.parse(this.responseText),
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
