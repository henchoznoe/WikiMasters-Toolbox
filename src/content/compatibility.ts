import { onAccountChange } from './account'

const issues = new Map<string, string>()
const listeners = new Set<() => void>()
export function onCompatibilityChange(listener: () => void): void {
  listeners.add(listener)
}
export function setCompatibilityIssue(
  source: string,
  message: string | null,
): void {
  if (message === null ? !issues.has(source) : issues.get(source) === message)
    return
  if (message) issues.set(source, message)
  else issues.delete(source)
  for (const listener of listeners) listener()
}
export function getCompatibilityIssues(page?: string): string[] {
  const sources: Record<string, string[]> = {
    collection: ['collection', 'card-ui', 'read:collection'],
    catalogue: ['catalogue', 'card-ui', 'read:catalogue'],
    trades: ['trades', 'card-ui', 'read:trades'],
    market: ['market', 'market-list', 'marketplace', 'card-ui', 'read:market'],
  }
  return [
    ...new Set(
      [...issues]
        .filter(([source]) => !page || sources[page]?.includes(source))
        .map(([, message]) => message),
    ),
  ]
}
export function resetCompatibility(): void {
  issues.clear()
  for (const listener of listeners) listener()
}

onAccountChange(resetCompatibility)
