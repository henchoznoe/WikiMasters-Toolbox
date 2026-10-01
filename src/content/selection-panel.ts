import { getCollectionState } from './collection'
import {
  cancelDiscard,
  checkSelection,
  editSelection,
  executeDiscard,
  getSelectionState,
  onSelectionChange,
  previewDiscard,
  resetSelection,
  stopDiscard,
  toggleCopy,
} from './collection-actions'
import { createRarityBadge } from './rarity'
import type { Protection } from './selection'

const RARITIES = ['C', 'PC', 'R', 'SR', 'UR', 'L']
let search = ''
let page = 0
let showSelected = false
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag)
  value.className = className
  value.textContent = text
  return value
}
function button(
  text: string,
  action: () => void,
  className = 'wm-quiet-button',
): HTMLButtonElement {
  const value = el('button', className, text)
  value.type = 'button'
  value.addEventListener('click', action)
  return value
}
function field(text: string, input: HTMLInputElement): HTMLLabelElement {
  const value = el('label', 'wm-selection-option')
  value.append(input, el('span', '', text))
  return value
}
export function createSelectionControls(): HTMLElement {
  const section = el('details', 'wm-selection')
  section.dataset.wmSelection = '1'
  section.append(el('summary', '', 'Select / discard'))
  section.addEventListener('toggle', () => {
    if (
      section.open &&
      !getSelectionState().ready &&
      !getSelectionState().results.length &&
      !['checking', 'running', 'verifying'].includes(getSelectionState().phase)
    )
      void checkSelection()
    if (!section.open) cancelDiscard()
  })
  const inner = el('div', 'wm-selection-body')
  const rarities = el('div', 'wm-selection-rarities')
  for (const rarity of RARITIES) {
    const value = button(rarity, () => {
      page = 0
      editSelection(rules => {
        rules.rarities.has(rarity)
          ? rules.rarities.delete(rarity)
          : rules.rarities.add(rarity)
        rules.added.clear()
        rules.removed.clear()
      })
    })
    value.dataset.wmSelectRarity = rarity
    value.classList.add('wm-rarity-surface')
    value.dataset.rarity = rarity.toLowerCase()
    value.replaceChildren(
      el('span', 'wm-stat-label', rarity),
      el('span', 'wm-stat-count', '0'),
    )
    rarities.append(value)
  }
  const protections = el('details', 'wm-selection-protections')
  protections.append(el('summary', '', 'Keep / protect'))
  const protectFields = el('div', 'wm-selection-options')
  for (const [key, label] of [
    ['favorites', 'Favorites'],
    ['tags', 'Tagged'],
    ['committed', 'Sale / trade'],
    ['unique', 'Only copy'],
    ['shiny', 'Shiny'],
  ] as [Protection, string][]) {
    const input = el('input')
    input.type = 'checkbox'
    input.checked = true
    input.dataset.wmProtect = key
    input.addEventListener('change', () =>
      editSelection(rules => {
        rules.protect[key] = input.checked
      }),
    )
    protectFields.append(field(label, input))
  }
  const keep = el('input', 'wm-selection-keep')
  keep.type = 'number'
  keep.min = '0'
  keep.max = '1000'
  keep.step = '1'
  keep.value = '1'
  keep.dataset.wmKeep = '1'
  keep.title =
    'Minimum copies kept for each catalogue ID, rarity and shiny variant'
  keep.addEventListener('change', () => {
    const value = Number(keep.value)
    editSelection(rules => {
      rules.keep =
        Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : 1
    })
    keep.value = String(getSelectionState().rules.keep)
  })
  protectFields.append(field('Keep per variant', keep))
  protections.append(protectFields)
  const status = el('p', 'wm-selection-total')
  status.dataset.wmSelectionTotal = '1'
  status.setAttribute('role', 'status')
  const actions = el('div', 'wm-collection-actions')
  const check = button('↻', () => {
    void checkSelection()
  })
  check.dataset.wmSelectionCheck = '1'
  check.title = 'Refresh collection and protections'
  check.setAttribute('aria-label', check.title)
  const clear = button('Clear', resetSelection)
  clear.dataset.wmSelectionClear = '1'
  const preview = button('Preview', previewDiscard, 'wm-primary-button')
  preview.dataset.wmSelectionPreview = '1'
  actions.append(check, clear, preview)
  const copies = el('details', 'wm-selection-copies')
  copies.append(el('summary', '', 'Adjust copies'))
  const query = el('input', 'wm-selection-search')
  query.type = 'search'
  query.placeholder = 'Search all copies'
  query.setAttribute('aria-label', 'Search all copies')
  query.addEventListener('input', () => {
    search = query.value
    page = 0
    renderCopyList(copies)
  })
  const selected = el('input')
  selected.type = 'checkbox'
  selected.addEventListener('change', () => {
    showSelected = selected.checked
    page = 0
    renderCopyList(copies)
  })
  const list = el('div', 'wm-selection-list')
  list.dataset.wmCopyList = '1'
  const pages = el('div', 'wm-selection-pagination')
  pages.dataset.wmCopyPages = '1'
  copies.append(query, field('Selected only', selected), list, pages)
  copies.addEventListener('toggle', () => {
    if (copies.open) renderCopyList(copies)
  })
  const review = el('div', 'wm-selection-review')
  review.dataset.wmDiscardReview = '1'
  const result = el('div', 'wm-selection-result')
  result.dataset.wmDiscardResult = '1'
  const note = el('p', 'wm-note')
  note.dataset.wmSelectionNote = '1'
  inner.append(
    rarities,
    protections,
    status,
    actions,
    copies,
    review,
    result,
    note,
  )
  section.append(inner)
  if (getSelectionState().results.length) section.open = true
  return section
}
function renderCopyList(section: HTMLElement): void {
  const list = section.querySelector<HTMLElement>('[data-wm-copy-list]')
  const pages = section.querySelector<HTMLElement>('[data-wm-copy-pages]')
  if (!list || !pages) return
  const value = getSelectionState()
  const selected = new Set(value.plan.cards.map(card => card.copyId))
  const query = search
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  const cards = getCollectionState().cards.filter(
    card =>
      (!showSelected || selected.has(card.copyId)) &&
      card.title
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .includes(query),
  )
  const total = Math.max(1, Math.ceil(cards.length / 30))
  page = Math.min(page, total - 1)
  const visible = cards.slice(page * 30, (page + 1) * 30)
  const signature = JSON.stringify([
    value.ready,
    value.phase,
    page,
    total,
    cards.length,
    visible.map(card => [
      card.copyId,
      selected.has(card.copyId),
      value.plan.blocked.get(card.copyId),
    ]),
  ])
  if (list.dataset.signature === signature) return
  list.dataset.signature = signature
  const active = (list.getRootNode() as ShadowRoot)
    .activeElement as HTMLElement | null
  const focusedCopy = active?.dataset.wmCopyId
  const scrollTop = list.scrollTop
  list.replaceChildren()
  for (const card of visible) {
    const input = el('input')
    input.dataset.wmCopyId = card.copyId
    input.type = 'checkbox'
    input.checked = selected.has(card.copyId)
    const reason = value.plan.blocked.get(card.copyId)
    input.disabled =
      !value.ready ||
      ['checking', 'verifying', 'running'].includes(value.phase) ||
      !!reason
    input.addEventListener('change', () =>
      toggleCopy(card.copyId, input.checked),
    )
    const row = field(`${card.shiny ? '✦ · ' : ''}${card.title}`, input)
    const title = row.querySelector('span')
    title?.prepend(createRarityBadge(card.rarity), document.createTextNode(' '))
    row.classList.add('wm-selection-copy')
    row.title = `${card.copyId}${reason ? ` · ${reason}` : ''}`
    if (reason) row.append(el('small', '', reason))
    list.append(row)
  }
  if (focusedCopy)
    [...list.querySelectorAll<HTMLInputElement>('input')]
      .find(input => input.dataset.wmCopyId === focusedCopy)
      ?.focus({ preventScroll: true })
  list.scrollTop = scrollTop
  const previous = button('←', () => {
    page--
    renderCopyList(section)
  })
  previous.setAttribute('aria-label', 'Previous copies')
  previous.disabled = page === 0
  const next = button('→', () => {
    page++
    renderCopyList(section)
  })
  next.setAttribute('aria-label', 'Next copies')
  next.disabled = page + 1 >= total
  pages.replaceChildren(
    previous,
    el('span', '', `${page + 1} / ${total} · ${cards.length}`),
    next,
  )
}
export function renderSelectionPanel(): void {
  const root = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-panel="collection"]',
  )?.shadowRoot
  const section = root?.querySelector<HTMLElement>('[data-wm-selection]')
  if (!section) return
  const value = getSelectionState()
  const busy = ['checking', 'verifying', 'running'].includes(value.phase)
  const counts = new Map<string, number>()
  for (const card of getCollectionState().cards)
    counts.set(card.rarity ?? '?', (counts.get(card.rarity ?? '?') ?? 0) + 1)
  for (const item of section.querySelectorAll<HTMLButtonElement>(
    '[data-wm-select-rarity]',
  )) {
    const rarity = item.dataset.wmSelectRarity ?? ''
    const count = item.querySelector('.wm-stat-count')
    if (count) count.textContent = String(counts.get(rarity) ?? 0)
    item.setAttribute('aria-label', `${rarity} ${counts.get(rarity) ?? 0}`)
    item.setAttribute('aria-pressed', String(value.rules.rarities.has(rarity)))
    item.disabled = !value.ready || busy
  }
  for (const item of section.querySelectorAll<HTMLInputElement>(
    '[data-wm-protect]',
  )) {
    item.checked = value.rules.protect[item.dataset.wmProtect as Protection]
    item.disabled = busy
  }
  const keep = section.querySelector<HTMLInputElement>('[data-wm-keep]')
  if (keep) {
    keep.disabled = busy
    if (root?.activeElement !== keep) keep.value = String(value.rules.keep)
  }
  const total = section.querySelector<HTMLElement>('[data-wm-selection-total]')
  if (total)
    total.textContent = busy
      ? `${value.phase === 'running' ? `${value.results.filter(item => item.status !== 'pending').length} / ${value.total}` : '…'}`
      : value.ready
        ? `${value.plan.cards.length} selected`
        : 'Check collection / protections'
  const preview = section.querySelector<HTMLButtonElement>(
    '[data-wm-selection-preview]',
  )
  if (preview)
    preview.disabled = busy || !value.ready || !value.plan.cards.length
  for (const key of ['check', 'clear']) {
    const item = section.querySelector<HTMLButtonElement>(
      `[data-wm-selection-${key}]`,
    )
    if (item) item.disabled = busy
  }
  const note = section.querySelector<HTMLElement>('[data-wm-selection-note]')
  if (note) {
    note.textContent = value.error ?? ''
    note.hidden = !value.error
  }
  const copies = section.querySelector<HTMLDetailsElement>(
    '.wm-selection-copies',
  )
  if (copies?.open) renderCopyList(copies)
  const review = section.querySelector<HTMLElement>('[data-wm-discard-review]')
  if (review) {
    // Preserve confirmation focus while unrelated prices or game DOM update.
    const key = value.reviewed
      ? JSON.stringify(value.plan.cards.map(card => card.copyId))
      : ''
    if (review.dataset.plan !== key) {
      review.dataset.plan = key
      review.replaceChildren()
      review.hidden = !value.reviewed
      if (value.reviewed) {
        review.append(
          el('h3', '', 'Discard preview'),
          el(
            'p',
            '',
            `${value.plan.cards.length} ${value.plan.cards.length === 1 ? 'copy' : 'copies'} · permanent`,
          ),
        )
        const table = el('div', 'wm-selection-list')
        for (const group of value.plan.groups) {
          const row = el(
            'p',
            '',
            ` ${group.shiny ? '✦ · ' : ''}${group.title} · ${group.before} → ${group.after}`,
          )
          row.prepend(createRarityBadge(group.rarity))
          table.append(row)
        }
        const rarities = el('div', 'wm-selection-rarities')
        for (const [rarity, count] of value.plan.rarities) {
          const badge = createRarityBadge(rarity)
          badge.append(document.createTextNode(` · ${count}`))
          rarities.append(badge)
        }
        review.append(rarities)
        review.append(table)
        if (
          value.plan.cards.some(card =>
            ['SR', 'UR', 'L'].includes(card.rarity ?? ''),
          )
        )
          review.append(
            el('p', 'wm-selection-warning', 'SR / UR / L in selection'),
          )
        review.append(
          el(
            'p',
            'wm-note',
            'Copies are permanently removed. Stop takes effect after the current request.',
          ),
        )
        const controls = el('div', 'wm-collection-actions')
        controls.append(
          button('Cancel', cancelDiscard),
          button(
            `Discard ${value.plan.cards.length}`,
            () => {
              void executeDiscard()
            },
            'wm-danger-button',
          ),
        )
        review.append(controls)
      }
    }
  }
  const result = section.querySelector<HTMLElement>('[data-wm-discard-result]')
  if (result) {
    const key = JSON.stringify([
      value.phase,
      value.results,
      value.total,
      value.stop,
    ])
    if (result.dataset.result !== key) {
      result.dataset.result = key
      result.replaceChildren()
      if (['checking', 'running', 'verifying'].includes(value.phase))
        result.append(button(value.stop ? 'Stopping…' : 'Stop', stopDiscard))
      if (value.results.length || value.phase === 'done') {
        const done = value.results.filter(
          item => item.status === 'discarded',
        ).length
        const failed = value.results.filter(
          item => item.status === 'failed',
        ).length
        const unknown = value.results.filter(
          item => item.status === 'unknown',
        ).length
        result.append(
          el(
            'p',
            'wm-selection-total',
            `${done} discarded · ${failed} failed · ${unknown} uncertain · ${value.total - value.results.length} not attempted`,
          ),
        )
        if (unknown)
          result.append(
            el(
              'p',
              'wm-selection-warning',
              'Uncertain result. Refresh and review before another action.',
            ),
          )
        const details = el('details')
        details.append(el('summary', '', 'Results'))
        const list = el('div', 'wm-selection-list')
        for (const item of value.results) {
          const row = el(
            'p',
            '',
            `${item.title} · ${item.status}${item.error ? ` · ${item.error}` : ''}`,
          )
          row.title = item.copyId
          list.append(row)
        }
        details.append(list)
        result.append(details)
      }
    }
  }
}
onSelectionChange(renderSelectionPanel)
