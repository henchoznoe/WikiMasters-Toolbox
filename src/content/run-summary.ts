import { getAccountId } from './account'

export type RunSummary = {
  accountId: string
  mode: 'manual' | 'auto'
  opened: number
  detail: string
  finishedAt: number
}

export const RUN_SUMMARY_KEY = 'wm_toolbox_last_pack_run_v1'

export function saveRunSummary(summary: RunSummary): void {
  try {
    sessionStorage.setItem(RUN_SUMMARY_KEY, JSON.stringify(summary))
  } catch {
    /* Session storage unavailable. */
  }
  renderRunSummary()
}

export function readRunSummary(): RunSummary | null {
  try {
    const raw = sessionStorage.getItem(RUN_SUMMARY_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<RunSummary>
    if (
      typeof value.accountId !== 'string' ||
      value.accountId !== getAccountId() ||
      (value.mode !== 'manual' && value.mode !== 'auto') ||
      !Number.isSafeInteger(value.opened) ||
      (value.opened ?? -1) < 0 ||
      typeof value.detail !== 'string' ||
      typeof value.finishedAt !== 'number'
    )
      return null
    return value as RunSummary
  } catch {
    return null
  }
}

export function renderRunSummary(): void {
  const details = document
    .querySelector<HTMLElement>('[data-wm-toolbox-panel]')
    ?.shadowRoot?.querySelector<HTMLDetailsElement>('[data-wm-toolbox-summary]')
  if (!details) return
  const summary = readRunSummary()
  details.hidden = !summary
  if (!summary) return
  const title = details.querySelector('summary')
  const text = details.querySelector('p')
  if (!title || !text) return
  title.textContent = `Last run · ${summary.opened} pack${summary.opened === 1 ? '' : 's'}`
  text.textContent = `${summary.mode === 'auto' ? 'Automatic' : 'Manual'} · ${summary.detail} · ${new Date(summary.finishedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`
}
