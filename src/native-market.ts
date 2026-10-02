import { type Card, mapCard } from './cards'
import { validSaleDraft } from './content/market-model'

type Fiber = {
  return?: Fiber
  key?: string | null
  memoizedProps?: Record<string, unknown>
}
type Context = { frame: HTMLElement; card: Card; input: HTMLInputElement }
/** Native components expose the exact possession as userCardId. Fail closed if this adapter changes. */
function nativeProps(element: HTMLElement): Record<string, unknown>[] {
  const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'))
  let fiber = key
    ? (element as unknown as Record<string, Fiber>)[key]
    : undefined
  const props: Record<string, unknown>[] = []
  for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
    if (fiber.memoizedProps) props.push(fiber.memoizedProps)
  }
  return props
}
export function findNativeSale(): Context | null {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Mise de départ"]',
  )
  const frame = input?.closest<HTMLElement>('.card-frame')
  if (!input || !frame) return null
  for (const props of nativeProps(input)) {
    if (typeof props.userCardId !== 'string' || !props.card) continue
    const card = mapCard(props.card)
    if (card)
      return { frame, input, card: { ...card, copyId: props.userCardId } }
  }
  return null
}
function findCopyElement(copyId: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(
    'main div[class*="cursor-pointer"][class*="rounded-2xl"]',
  )) {
    const key = Object.keys(element).find(key =>
      key.startsWith('__reactFiber$'),
    )
    let fiber = key
      ? (element as unknown as Record<string, Fiber>)[key]
      : undefined
    for (let depth = 0; fiber && depth < 10; depth++, fiber = fiber.return) {
      if (fiber.key === copyId) return element
    }
  }
  return null
}
function setNativeValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
export function installNativeMarket(
  account: () => string | null,
  emit: (data: Record<string, unknown>) => void,
): void {
  let signature = ''
  let grant: { copyId: string; accountId: string; until: number } | null = null
  let path = location.pathname
  let opening = 0
  function sync(): void {
    if (path !== location.pathname) {
      path = location.pathname
      grant = null
      opening++
    }
    const context = findNativeSale()
    const next = context ? JSON.stringify(context.card) : ''
    if (next === signature) return
    signature = next
    grant = null
    emit({
      kind: 'sale-context',
      accountId: account(),
      card: context?.card ?? null,
    })
  }
  const observer = new MutationObserver(sync)
  const start = (): void => {
    if (!document.body) {
      requestAnimationFrame(start)
      return
    }
    observer.observe(document.body, { subtree: true, childList: true })
    sync()
  }
  start()
  window.addEventListener('wm-toolbox:native-market', event => {
    try {
      const command = JSON.parse((event as CustomEvent<string>).detail)
      if (!account() || command.accountId !== account()) return
      if (command.action === 'revoke') {
        grant = null
        opening++
        return
      }
      const context = findNativeSale()
      if (
        command.action === 'approve' &&
        context?.card.copyId === command.copyId
      ) {
        grant = {
          copyId: command.copyId,
          accountId: command.accountId,
          until: Date.now() + 30_000,
        }
      } else if (
        command.action === 'fill' &&
        context &&
        context.card.copyId === command.copyId &&
        validSaleDraft(command.amount, command.duration)
      ) {
        setNativeValue(context.input, String(command.amount))
        const label =
          command.duration < 60
            ? `${command.duration} min`
            : `${command.duration / 60} h`
        const button = [...context.frame.querySelectorAll('button')].find(
          button => button.textContent?.trim() === label,
        )
        button?.click()
      } else if (
        command.action === 'inspect' &&
        typeof command.copyId === 'string' &&
        typeof command.title === 'string' &&
        /^\/collection\/?$/.test(location.pathname)
      ) {
        grant = null
        const current = ++opening
        const search = document.querySelector<HTMLInputElement>(
          'input[placeholder="Rechercher par titre ou catégorie..."]',
        )
        if (!search) return
        setNativeValue(search, command.title)
        // Native search is asynchronous. The title only filters; the React key identifies the copy.
        let tries = 0
        const open = (): void => {
          if (current !== opening || command.accountId !== account()) return
          const element = findCopyElement(command.copyId)
          if (element) {
            element.click()
            if (command.sale === true)
              setTimeout(() => {
                if (current !== opening || command.accountId !== account())
                  return
                for (const button of document.querySelectorAll<HTMLButtonElement>(
                  'button',
                )) {
                  if (button.textContent?.trim() !== 'Mettre aux enchères')
                    continue
                  if (
                    nativeProps(button).some(
                      props => props.userCardId === command.copyId,
                    )
                  ) {
                    button.click()
                    return
                  }
                }
              }, 150)
            return
          }
          if (++tries < 20) setTimeout(open, 300)
          else emit({ kind: 'sale-adapter-error', accountId: account() })
        }
        open()
      }
    } catch {
      /* Ignore malformed UI commands. */
    }
  })
  document.addEventListener(
    'click',
    event => {
      const button = (event.target as Element | null)?.closest('button')
      if (button?.textContent?.trim() !== "Lancer l'enchère") return
      const context = findNativeSale()
      if (!context) {
        event.preventDefault()
        event.stopImmediatePropagation()
        emit({ kind: 'sale-adapter-error', accountId: account() })
        return
      }
      const allowed =
        grant &&
        grant.accountId === account() &&
        grant.copyId === context.card.copyId &&
        grant.until > Date.now()
      const approval = new CustomEvent('wm-toolbox:sale-submit', {
        detail: JSON.stringify({
          accountId: account(),
          card: context.card,
          amount: Number(context.input.value),
        }),
        cancelable: true,
      })
      if (!allowed || !window.dispatchEvent(approval)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        grant = null
        emit({ kind: 'sale-check-required', accountId: account() })
      } else grant = null
    },
    true,
  )
}
