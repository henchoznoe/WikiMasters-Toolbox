import type { OwnedCard } from '../cards'
import { onAccountChange } from './account'
import { getCollectionState } from './collection'
import {
  checkSelection,
  editSelection,
  getSelectionState,
  toggleCopy,
} from './collection-actions'
import { renderCompactLayout } from './collection-layout'
import {
  type CollectionQuery,
  copyAvailability,
  defaultCollectionQuery,
  queryCollectionView,
  SORTS,
  type TriState,
  variantGroups,
} from './collection-query'
import {
  deleteView,
  getViewPreferences,
  markViewSynced,
  saveView,
  setCompact,
} from './collection-views'
import { statusLabel } from './presentation'
import { presentPrice } from './price-presentation'
import { readPriceQuote } from './price-store'
import { createRarityBadge } from './rarity'
import { inspectCopy } from './sale'

let query = defaultCollectionQuery()
let page = 0
let grouped = false
let selectedView = ''
onAccountChange(() => {
  query = defaultCollectionQuery()
  page = 0
  grouped = false
  selectedView = ''
})
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag)
  value.textContent = text
  value.className = className
  return value
}
function button(text: string, action: () => void): HTMLButtonElement {
  const value = el('button', text, 'wm-quiet-button')
  value.type = 'button'
  value.addEventListener('click', action)
  return value
}
function label(text: string, control: HTMLElement): HTMLLabelElement {
  const value = el('label', '', 'wm-browser-field')
  value.append(el('span', text), control)
  return value
}
function update(): void {
  page = 0
  renderCollectionBrowser()
}
function select(
  options: [string, string][],
  change: (value: string) => void,
): HTMLSelectElement {
  const input = el('select')
  for (const [value, text] of options) {
    const item = el('option', text)
    item.value = value
    input.append(item)
  }
  input.addEventListener('change', () => {
    change(input.value)
    update()
  })
  return input
}
export function createCompactControls(): HTMLElement {
  const input = el('input')
  input.type = 'checkbox'
  input.dataset.wmCompact = '1'
  input.checked = getViewPreferences().compact
  input.addEventListener('change', () => {
    setCompact(input.checked)
    renderCompactLayout()
  })
  return label('Cartes compactes', input)
}
export function createCollectionBrowser(): HTMLElement {
  const section = el('details', '', 'wm-collection-browser')
  section.dataset.wmCollectionBrowser = '1'
  section.append(el('summary', 'Filtres / vues / doublons'))
  const body = el('div', '', 'wm-browser-body')
  const filters = el('div', '', 'wm-browser-filters')
  for (const [key, text] of [
    ['search', 'Titre'],
    ['category', 'Catégorie'],
  ] as const) {
    const input = el('input')
    input.type = 'search'
    input.maxLength = 200
    input.value = query[key]
    input.dataset.wmQuery = key
    input.addEventListener('input', () => {
      query[key] = input.value
      update()
    })
    filters.append(label(text, input))
  }
  const rarities = el('div', '', 'wm-selection-rarities')
  for (const rarity of ['C', 'PC', 'R', 'SR', 'UR', 'L']) {
    const item = button(rarity, () => {
      query.rarities = query.rarities.includes(rarity)
        ? query.rarities.filter(r => r !== rarity)
        : [...query.rarities, rarity]
      update()
    })
    item.classList.add('wm-rarity-surface')
    item.dataset.rarity = rarity.toLowerCase()
    item.dataset.wmFilterRarity = rarity
    rarities.append(item)
  }
  for (const [key, text] of [
    ['favorite', 'Favori'],
    ['duplicate', 'Variante en double'],
    ['knownPrice', 'Prix connu'],
    ['missingImage', 'Sans image'],
  ] as const) {
    const input = select(
      [
        ['any', 'Tous'],
        ['yes', 'Oui'],
        ['no', 'Non'],
      ],
      value => {
        query[key] = value as TriState
      },
    )
    input.dataset.wmQuery = key
    input.value = query[key]
    filters.append(label(text, input))
  }
  const tags = select(
    [
      ['', 'Tous'],
      ['@tagged', 'Avec étiquette'],
      ['@untagged', 'Sans étiquette'],
    ],
    value => {
      query.tag = value
    },
  )
  tags.dataset.wmQuery = 'tag'
  filters.append(label('Étiquette', tags))
  for (const [key, text] of [
    ['priceMin', 'Prix min · W'],
    ['priceMax', 'Prix max · W'],
    ['atkMin', 'ATK min'],
    ['atkMax', 'ATK max'],
    ['defMin', 'DEF min'],
    ['defMax', 'DEF max'],
  ] as const) {
    const input = el('input')
    input.type = 'number'
    input.min = '0'
    input.step = 'any'
    input.dataset.wmQuery = key
    input.value = query[key] === null ? '' : String(query[key])
    input.addEventListener('input', () => {
      const n = input.value === '' ? null : Number(input.value)
      if (n === null || (Number.isFinite(n) && n >= 0)) {
        query[key] = n
        update()
      }
    })
    filters.append(label(text, input))
  }
  const sort = select(
    SORTS.map(key => [
      key,
      {
        title: 'Titre',
        price: 'Prix',
        quantity: 'Quantité',
        rarity: 'Rareté',
        atk: 'ATK',
        def: 'DEF',
        ratio: 'ATK / DEF',
        obtained: 'Acquisition',
      }[key],
    ]),
    value => {
      query.sort = value as CollectionQuery['sort']
    },
  )
  sort.dataset.wmQuery = 'sort'
  sort.value = query.sort
  const direction = select(
    [
      ['asc', 'Croissant'],
      ['desc', 'Décroissant'],
    ],
    value => {
      query.descending = value === 'desc'
    },
  )
  direction.dataset.wmDirection = '1'
  direction.value = query.descending ? 'desc' : 'asc'
  const group = el('input')
  group.type = 'checkbox'
  group.checked = grouped
  group.addEventListener('change', () => {
    grouped = group.checked
    update()
  })
  const controls = el('div', '', 'wm-browser-filters')
  controls.append(
    label('Tri', sort),
    label('Ordre', direction),
    label('Regrouper les doublons', group),
    createCompactControls(),
  )
  const saved = select([['', 'Vues personnelles']], value => {
    selectedView = value
    const view = getViewPreferences().views.find(v => v.name === value)
    if (view) {
      query = view.query
      syncInputs(section)
    }
  })
  saved.dataset.wmSavedView = '1'
  const name = el('input')
  name.maxLength = 60
  name.required = true
  name.placeholder = 'Nom de la vue'
  name.setAttribute('aria-label', 'Nom de la vue')
  const viewActions = el('div', '', 'wm-collection-actions')
  viewActions.append(
    saved,
    name,
    button('Enregistrer la vue', () => {
      if (!name.reportValidity()) return
      const nameValue = name.value.trim()
      const state = getCollectionState()
      if (
        saveView(
          nameValue,
          query,
          state.status === 'complete' ? state.updatedAt : 0,
        )
      ) {
        selectedView = nameValue
        name.value = ''
        renderCollectionBrowser()
      }
    }),
    button('Supprimer la vue', () => {
      deleteView(selectedView)
      selectedView = ''
      renderCollectionBrowser()
    }),
  )
  const status = el('p', '', 'wm-note')
  status.dataset.wmBrowserStatus = '1'
  status.setAttribute('role', 'status')
  const actions = el('div', '', 'wm-collection-actions')
  const selectMatches = button('Sélectionner les résultats', () => {
    if (!getSelectionState().ready) return
    const indexed = getCollectionState().cards
    const matches = queryCollectionView(indexed, query, readPriceQuote, grouped)
    editSelection(rules => {
      for (const card of matches) {
        rules.removed.delete(card.copyId)
        rules.added.add(card.copyId)
      }
    })
  })
  selectMatches.dataset.wmSelectMatches = '1'
  const check = button('Vérifier les protections', () => {
    void checkSelection()
  })
  check.dataset.wmBrowserCheck = '1'
  actions.append(
    button('Réinitialiser les filtres', () => {
      query = defaultCollectionQuery()
      selectedView = ''
      syncInputs(section)
      update()
    }),
    check,
    selectMatches,
  )
  const note = el(
    'p',
    'Index local · prix en cache · protections conservées. Les groupes montrent toutes les copies ; « Sélectionner les résultats » ajoute uniquement les copies filtrées.',
    'wm-note',
  )
  note.title =
    'Aucune requête de prix supplémentaire. Les valeurs inconnues restent en fin de tri ; les prix des brillantes sont inconnus. Une carte engagée au niveau du catalogue est en vente / échange, sans identification de la copie exacte.'
  const list = el('div', '', 'wm-browser-results')
  list.dataset.wmBrowserResults = '1'
  const pagination = el('div', '', 'wm-selection-pagination')
  pagination.dataset.wmBrowserPages = '1'
  body.append(
    rarities,
    filters,
    controls,
    viewActions,
    status,
    actions,
    note,
    list,
    pagination,
  )
  section.append(body)
  section.addEventListener('toggle', renderCollectionBrowser)
  return section
}
function syncInputs(section: HTMLElement): void {
  for (const input of section.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >('[data-wm-query]')) {
    const value = query[input.dataset.wmQuery as keyof CollectionQuery]
    input.value = value === null ? '' : String(value)
  }
  const direction = section.querySelector<HTMLSelectElement>(
    '[data-wm-direction]',
  )
  if (direction) direction.value = query.descending ? 'desc' : 'asc'
}
function copyRow(
  card: OwnedCard,
  selected: Set<string>,
  busy: boolean,
  state: ReturnType<typeof getSelectionState>,
): HTMLElement {
  const row = el('div', '', 'wm-browser-copy')
  const check = el('input')
  check.type = 'checkbox'
  check.checked = selected.has(card.copyId)
  check.setAttribute(
    'aria-label',
    `Sélectionner ${card.title} · ${card.copyId}`,
  )
  const blocked = state.plan.blocked.get(card.copyId)
  check.disabled = busy || !state.ready || !!blocked
  check.title = blocked ?? 'Sélectionner cette copie identifiée'
  check.dataset.wmBrowserCopy = card.copyId
  check.addEventListener('change', () => toggleCopy(card.copyId, check.checked))
  const text = el('div')
  const heading = el(
    'div',
    `${card.shiny ? '✦ ' : ''}${card.title}`,
    'wm-browser-title',
  )
  heading.prepend(createRarityBadge(card.rarity), document.createTextNode(' '))
  const price = card.shiny
    ? { value: '—', age: '', hint: 'Prix des brillantes indisponible' }
    : presentPrice(readPriceQuote(card.id, card.rarity))
  const availability = copyAvailability(card, state.commitments, state.ready)
  const meta = el(
    'small',
    `${price.value}${price.age ? ` · ${price.age}` : ''} · ATK ${card.atk ?? '—'} / DEF ${card.def ?? '—'} · ${statusLabel(availability)}${blocked ? ` · ${blocked}` : ''}`,
  )
  meta.title = price.hint
  text.append(heading, meta)
  const inspect = button('Inspecter', () => inspectCopy(card.copyId))
  inspect.disabled = busy || getCollectionState().status !== 'complete'
  inspect.title = `Ouvrir la copie exacte ${card.copyId} dans le jeu`
  row.title = `${card.copyId}${card.obtainedAt ? ` · ${card.obtainedAt}` : ''}${card.category ? ` · ${card.category}` : ''}`
  row.append(check, text, inspect)
  return row
}
export function renderCollectionBrowser(): void {
  const root = document.querySelector<HTMLElement>(
    '[data-wm-toolbox-panel="collection"]',
  )?.shadowRoot
  const section = root?.querySelector<HTMLDetailsElement>(
    '[data-wm-collection-browser]',
  )
  if (!section?.open) return
  const state = getCollectionState(),
    selection = getSelectionState(),
    prefs = getViewPreferences()
  const busy = ['checking', 'verifying', 'running'].includes(selection.phase)
  const allGroups = variantGroups(state.cards)
  const cards = queryCollectionView(state.cards, query, readPriceQuote, grouped)
  const groups = [...variantGroups(cards).keys()].filter(
    key => (allGroups.get(key)?.length ?? 0) > 1,
  )
  const entries = grouped ? groups : cards
  const total = Math.max(1, Math.ceil(entries.length / 24))
  page = Math.min(page, total - 1)
  const status = section.querySelector<HTMLElement>('[data-wm-browser-status]')
  if (status)
    status.textContent = `${cards.length} / ${state.cards.length} résultats · ${state.status === 'complete' ? 'index complet' : state.status === 'loading' ? '… index partiel' : 'index partiel / ancien'}${grouped ? ` · ${groups.length} variantes en double` : ''}${state.updatedAt ? ` · synchronisé le ${new Date(state.updatedAt).toLocaleString('fr-FR')}` : ''}${prefs.error ? ` · ${prefs.error}` : ''}`
  for (const item of section.querySelectorAll<HTMLButtonElement>(
    '[data-wm-filter-rarity]',
  ))
    item.setAttribute(
      'aria-pressed',
      String(query.rarities.includes(item.dataset.wmFilterRarity ?? '')),
    )
  const matches = section.querySelector<HTMLButtonElement>(
    '[data-wm-select-matches]',
  )
  if (matches) matches.disabled = busy || !selection.ready || !cards.length
  const check = section.querySelector<HTMLButtonElement>(
    '[data-wm-browser-check]',
  )
  if (check) check.disabled = busy
  const tags = section.querySelector<HTMLSelectElement>('[data-wm-query="tag"]')
  if (tags) {
    const names = new Map<string, string>()
    for (const card of state.cards)
      for (const id of card.tagIds) names.set(id, card.tagNames?.[id] ?? id)
    const signature = JSON.stringify([[...names], query.tag])
    if (tags.dataset.signature !== signature) {
      tags.dataset.signature = signature
      tags.replaceChildren(
        ...[
          ['', 'Tous'],
          ['@tagged', 'Avec étiquette'],
          ['@untagged', 'Sans étiquette'],
          ...[...names].sort((a, b) => a[1].localeCompare(b[1])),
        ].map(([id, name]) => {
          const item = el('option', name)
          item.value = id
          return item
        }),
      )
      if (query.tag && ![...tags.options].some(o => o.value === query.tag)) {
        const item = el('option', `${query.tag} · absent`)
        item.value = query.tag
        tags.append(item)
      }
      tags.value = query.tag
    }
  }
  const saved = section.querySelector<HTMLSelectElement>('[data-wm-saved-view]')
  if (saved) {
    const signature = JSON.stringify(prefs.views)
    if (saved.dataset.signature !== signature) {
      saved.dataset.signature = signature
      saved.replaceChildren(
        ...[
          ['', 'Vues personnelles'],
          ...prefs.views.map(v => [
            v.name,
            `${v.name} · ${v.syncedAt ? new Date(v.syncedAt).toLocaleString('fr-FR') : 'non synchronisé'}`,
          ]),
        ].map(([value, text]) => {
          const item = el('option', text)
          item.value = value
          return item
        }),
      )
    }
    saved.value = selectedView
  }
  if (selectedView && state.status === 'complete')
    markViewSynced(selectedView, query, state.updatedAt)
  const list = section.querySelector<HTMLElement>('[data-wm-browser-results]')
  const selected = new Set(selection.plan.cards.map(c => c.copyId))
  if (list) {
    const visible = entries.slice(page * 24, (page + 1) * 24)
    const signature = JSON.stringify([
      visible,
      state.status,
      state.updatedAt,
      grouped,
      busy,
      selection.ready,
      [...selected],
      [...selection.plan.blocked],
      [...selection.commitments.copyIds],
      [...selection.commitments.catalogueIds],
      cards.map(c => [c.copyId, readPriceQuote(c.id, c.rarity)]),
    ])
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature
      const active = root?.activeElement as HTMLElement | null,
        focused = active?.dataset.wmBrowserCopy,
        top = list.scrollTop
      const expanded = new Set(
        [...list.querySelectorAll<HTMLDetailsElement>('details[open]')].map(
          e => e.dataset.wmVariant,
        ),
      )
      list.replaceChildren()
      for (const entry of visible) {
        if (typeof entry !== 'string')
          list.append(copyRow(entry, selected, busy, selection))
        else {
          const copies = allGroups.get(entry) ?? [],
            counts = new Map<string, number>()
          for (const card of copies) {
            const status = copyAvailability(
              card,
              selection.commitments,
              selection.ready,
            )
            counts.set(status, (counts.get(status) ?? 0) + 1)
          }
          const details = el('details', '', 'wm-browser-group')
          details.dataset.wmVariant = entry
          const heading = el(
            'summary',
            `${copies[0].title} · ${copies.length} copies · ${[...counts].map(([key, n]) => `${n} ${statusLabel(key)}`).join(' / ')}`,
          )
          heading.prepend(
            createRarityBadge(copies[0].rarity),
            document.createTextNode(copies[0].shiny ? ' ✦ ' : ' '),
          )
          details.append(heading)
          details.addEventListener('toggle', () => {
            if (details.open && details.childElementCount === 1)
              for (const card of copies)
                details.append(copyRow(card, selected, busy, selection))
          })
          if (expanded.has(entry)) {
            details.open = true
            for (const card of copies)
              details.append(copyRow(card, selected, busy, selection))
          }
          list.append(details)
        }
      }
      if (!visible.length) list.append(el('p', 'Aucun résultat', 'wm-note'))
      if (focused)
        [...list.querySelectorAll<HTMLInputElement>('[data-wm-browser-copy]')]
          .find(e => e.dataset.wmBrowserCopy === focused)
          ?.focus({ preventScroll: true })
      list.scrollTop = top
    }
  }
  const pagination = section.querySelector<HTMLElement>(
    '[data-wm-browser-pages]',
  )
  if (
    pagination &&
    pagination.dataset.signature !== `${page}/${total}/${entries.length}`
  ) {
    pagination.dataset.signature = `${page}/${total}/${entries.length}`
    const previous = button('←', () => {
      page--
      renderCollectionBrowser()
    })
    previous.setAttribute('aria-label', 'Résultats précédents')
    previous.disabled = !page
    const next = button('→', () => {
      page++
      renderCollectionBrowser()
    })
    next.setAttribute('aria-label', 'Résultats suivants')
    next.disabled = page + 1 === total
    pagination.replaceChildren(
      previous,
      el('span', `${page + 1} / ${total} · ${entries.length}`),
      next,
    )
  }
}
