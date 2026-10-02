import {
  getManualLimit,
  getPrefs,
  getStatus,
  onOpenAllClick,
  setAutoEnabled,
  setManualLimit,
  setMaxMinutes,
  setMinMinutes,
  syncPrefsFromStorage,
  updateOpenAllButton,
} from './packs'
import { renderRunSummary, setRunSummaryExpanded } from './run-summary'
import { renderStats } from './stats'

function makeInput(
  labelText: string,
  value: number,
  onChange: (value: number) => void,
): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'wm-field'
  const caption = document.createElement('span')
  caption.textContent = labelText
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.max = '10080'
  input.value = String(value)
  input.addEventListener('change', () => onChange(Number(input.value)))
  label.append(caption, input)
  return label
}

export function createPacksBody(): HTMLElement {
  const prefs = getPrefs()
  const body = document.createElement('div')
  body.className = 'wm-panel-body'
  const limitLabel = document.createElement('label')
  limitLabel.className = 'wm-field wm-manual-limit'
  const limitCaption = document.createElement('span')
  limitCaption.textContent = 'Packs per manual run (optional)'
  const limitInput = document.createElement('input')
  limitInput.dataset.wmToolboxManualLimit = '1'
  limitInput.type = 'number'
  limitInput.min = '1'
  limitInput.max = '100'
  limitInput.placeholder = 'All available'
  limitInput.value = getManualLimit()?.toString() ?? ''
  limitInput.addEventListener('change', () => {
    setManualLimit(limitInput.value === '' ? null : Number(limitInput.value))
    limitInput.value = getManualLimit()?.toString() ?? ''
  })
  limitLabel.append(limitCaption, limitInput)
  const openAllButton = document.createElement('button')
  openAllButton.type = 'button'
  openAllButton.dataset.wmToolboxOpenAll = '1'
  openAllButton.className = 'wm-primary-button wm-open-all'
  openAllButton.textContent = 'Open all available packs'
  openAllButton.addEventListener('click', onOpenAllClick)

  const progress = document.createElement('div')
  progress.dataset.wmToolboxProgress = '1'
  progress.className = 'wm-progress'
  progress.hidden = true
  const progressLabel = document.createElement('span')
  progressLabel.dataset.wmToolboxProgressLabel = '1'
  progressLabel.textContent = 'Checking available packs…'
  const progressMeter = document.createElement('progress')
  progressMeter.max = 1
  progress.append(progressLabel, progressMeter)

  const runSummary = document.createElement('details')
  runSummary.dataset.wmToolboxSummary = '1'
  runSummary.className = 'wm-run-summary'
  runSummary.hidden = true
  runSummary.append(
    document.createElement('summary'),
    document.createElement('p'),
  )
  runSummary.addEventListener('toggle', () =>
    setRunSummaryExpanded(runSummary.open),
  )

  const toggleLabel = document.createElement('label')
  toggleLabel.className = 'wm-setting-toggle'
  toggleLabel.style.marginTop = '13px'
  const toggle = document.createElement('input')
  toggle.dataset.wmToolboxAuto = '1'
  toggle.type = 'checkbox'
  toggle.checked = prefs.enabled
  toggle.addEventListener('change', () => {
    setAutoEnabled(toggle.checked)
    refreshPacksControls()
  })
  const toggleTrack = document.createElement('span')
  toggleTrack.className = 'wm-switch'
  toggleTrack.setAttribute('aria-hidden', 'true')
  toggleLabel.append(
    toggle,
    toggleTrack,
    document.createTextNode('Open packs automatically'),
  )

  const fields = document.createElement('div')
  fields.className = 'wm-fields'
  fields.append(
    makeInput('Min. (minutes)', prefs.minMinutes, value => {
      setMinMinutes(value)
      refreshPacksControls()
    }),
    makeInput('Max. (minutes)', prefs.maxMinutes, value => {
      setMaxMinutes(value)
      refreshPacksControls()
    }),
  )
  const status = document.createElement('p')
  status.dataset.wmToolboxStatus = '1'
  status.setAttribute('role', 'status')
  status.className = 'wm-status'
  status.textContent = getStatus()
  status.hidden = getStatus() === 'Disabled'
  const note = document.createElement('p')
  note.className = 'wm-note'
  note.textContent = 'Keep this tab open for scheduled opening.'
  const autoDetails = document.createElement('div')
  autoDetails.className = 'wm-auto-details'
  autoDetails.dataset.wmToolboxAutoDetails = '1'
  autoDetails.hidden = !prefs.enabled
  autoDetails.append(fields, note)
  const stats = document.createElement('section')
  stats.dataset.wmToolboxStats = '1'
  stats.className = 'wm-stats'
  body.append(
    limitLabel,
    openAllButton,
    progress,
    runSummary,
    toggleLabel,
    autoDetails,
    status,
    stats,
  )
  return body
}

export function mountPacksBody(): void {
  // Restore the verification notice even when automatic opening is disabled.
  if (getPrefs().verificationRequired) syncPrefsFromStorage()
  updateOpenAllButton()
  renderRunSummary()
  renderStats()
}

export function refreshPacksControls(): void {
  const root = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-panel]',
  )?.shadowRoot
  if (!root) return
  const prefs = getPrefs()
  const toggle = root.querySelector<HTMLInputElement>('[data-wm-toolbox-auto]')
  if (toggle) toggle.checked = prefs.enabled
  const autoDetails = root.querySelector<HTMLElement>(
    '[data-wm-toolbox-auto-details]',
  )
  if (autoDetails) autoDetails.hidden = !prefs.enabled
  const inputs = root.querySelectorAll<HTMLInputElement>('.wm-fields input')
  if (inputs[0]) inputs[0].value = String(prefs.minMinutes)
  if (inputs[1]) inputs[1].value = String(prefs.maxMinutes)
  const limit = root.querySelector<HTMLInputElement>(
    '[data-wm-toolbox-manual-limit]',
  )
  if (limit) limit.value = getManualLimit()?.toString() ?? ''
}
