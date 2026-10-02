import { getAccountId } from './account'
import {
  type CacheKind,
  cachePolicies,
  clearCache,
  inspectCache,
} from './cache'
import { getCompatibilityIssues } from './compatibility'
import { resolvePageAdapter } from './page-adapters'
import { requestLimit } from './requests'

export function createDataControls(): HTMLElement {
  const details = document.createElement('details')
  details.className = 'wm-run-summary wm-data-controls'
  details.dataset.wmToolboxData = '1'
  const summary = document.createElement('summary')
  summary.textContent = 'Data & caches'
  const body = document.createElement('div')
  body.className = 'wm-run-body'
  const status = document.createElement('p')
  status.dataset.wmDataStatus = '1'
  status.className = 'wm-note'
  status.setAttribute('role', 'status')
  const caches = document.createElement('div')
  caches.dataset.wmDataCaches = '1'
  details.append(summary, body)
  body.append(status, caches)
  details.addEventListener('toggle', () => {
    if (details.open) renderDataControls()
  })
  return details
}
export function renderDataControls(): void {
  const root = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-panel]',
  )?.shadowRoot
  const status = root?.querySelector<HTMLElement>('[data-wm-data-status]')
  if (!root || !status) return
  const issues = getCompatibilityIssues(
    resolvePageAdapter(location.pathname)?.id,
  )
  const text =
    [...issues, requestLimit()].filter(Boolean).join(' · ') ||
    (getAccountId()
      ? 'Account detected · personal data isolated'
      : 'Waiting for your WikiMasters account…')
  if (status.textContent !== text) status.textContent = text
  const summary = root.querySelector<HTMLElement>(
    '[data-wm-toolbox-data] > summary',
  )
  const title = issues.length ? 'Data & caches · !' : 'Data & caches'
  if (summary && summary.textContent !== title) summary.textContent = title
  const container = root.querySelector<HTMLElement>('[data-wm-data-caches]')
  const details = root.querySelector<HTMLDetailsElement>(
    '[data-wm-toolbox-data]',
  )
  if (!container || !details?.open) return
  const owner = getAccountId()
  const items = (Object.keys(cachePolicies) as CacheKind[]).map(kind => ({
    kind,
    ...inspectCache(kind),
  }))
  const signature = JSON.stringify([owner, items])
  if (container.dataset.signature === signature) return
  container.dataset.signature = signature
  container.replaceChildren()
  for (const item of items) {
    const policy = cachePolicies[item.kind]
    const row = document.createElement('div')
    row.className = 'wm-cache-row'
    const info = document.createElement('span')
    info.textContent = `${policy.label} · ${item.count} · ${Math.ceil(item.bytes / 1024)} KB`
    const date = document.createElement('small')
    date.className = 'wm-cache-date'
    date.textContent = `Sync: ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}`
    info.append(date)
    info.title = `Last sync: ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'}. Fresh for ${policy.freshness / 60_000} min; retained ${policy.retention / 86400_000} days. Maximum ${policy.maxEntries} entries / ${policy.maxBytes / 1024 / 1024} MB across accounts.`
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'wm-quiet-button'
    button.textContent = 'Clear'
    button.setAttribute(
      'aria-label',
      `Clear ${policy.label.toLowerCase()} cache`,
    )
    button.disabled = !item.count || (policy.account && !owner)
    button.addEventListener('click', () => {
      if (getAccountId() !== owner) return
      if (
        (item.kind === 'history' || item.kind === 'sales') &&
        !window.confirm(
          'Clear local price or sale observations? Past observations cannot be restored.',
        )
      )
        return
      clearCache(item.kind)
      renderDataControls()
    })
    row.append(info, button)
    container.append(row)
  }
}
