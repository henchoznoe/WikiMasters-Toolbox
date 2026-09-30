import {
  getPrefs,
  getStatus,
  onOpenAllClick,
  setAutoEnabled,
  setMaxMinutes,
  setMinMinutes,
  updateOpenAllButton,
} from './packs'
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

  const toggleLabel = document.createElement('label')
  toggleLabel.className = 'wm-setting-toggle'
  toggleLabel.style.marginTop = '13px'
  const toggle = document.createElement('input')
  toggle.dataset.wmToolboxAuto = '1'
  toggle.type = 'checkbox'
  toggle.checked = prefs.enabled
  toggle.addEventListener('change', () => setAutoEnabled(toggle.checked))
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
  const note = document.createElement('p')
  note.className = 'wm-note'
  note.textContent = 'Keep this tab open for scheduled opening.'
  const stats = document.createElement('section')
  stats.dataset.wmToolboxStats = '1'
  stats.className = 'wm-stats'
  body.append(openAllButton, progress, toggleLabel, fields, status, note, stats)
  return body
}

export function mountPacksBody(): void {
  updateOpenAllButton()
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
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="number"]')
  if (inputs[0]) inputs[0].value = String(prefs.minMinutes)
  if (inputs[1]) inputs[1].value = String(prefs.maxMinutes)
}
