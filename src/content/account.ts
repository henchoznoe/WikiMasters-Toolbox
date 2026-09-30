const ACCOUNT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let accountId: string | null = null

export function getAccountId(): string | null {
  return accountId
}

export function setAccountId(value: unknown): boolean {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value)) return false
  const nextId = value.toLowerCase()
  if (nextId === accountId) return false
  accountId = nextId
  return true
}
