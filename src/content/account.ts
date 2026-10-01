const ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let accountId: string | null = null
const listeners = new Set<() => void>()

export function onAccountChange(listener: () => void): void {
  listeners.add(listener)
}

export function getAccountId(): string | null {
  return accountId
}

export function setAccountId(value: unknown): boolean {
  if (
    value !== null &&
    (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value))
  )
    return false
  const nextId = typeof value === 'string' ? value.toLowerCase() : null
  if (nextId === accountId) return false
  accountId = nextId
  for (const listener of listeners) listener()
  return true
}
