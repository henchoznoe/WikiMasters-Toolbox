import type { Observation } from './price-model'

const DAY = 86400_000
export type TimelineDay = {
  day: number
  at: number
  average: number | null
  kind: 'price' | 'no-sales' | 'missing'
}
/** One point per UTC day. Empty days carry no inferred value. */
export function priceTimeline(
  points: Observation[],
  now = Date.now(),
): TimelineDay[] {
  const observations = new Map<number, Observation>()
  for (const point of [...points].sort((a, b) => a.at - b.at)) {
    if (
      !Number.isFinite(point.at) ||
      point.at > now ||
      point.at < now - 90 * DAY ||
      (point.average !== null &&
        (!Number.isFinite(point.average) || point.average < 0))
    )
      continue
    observations.set(Math.floor(point.at / DAY), point)
  }
  const days = [...observations.keys()]
  if (!days.length) return []
  const first = Math.min(...days)
  const last = Math.max(...days)
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const day = first + index
    const point = observations.get(day)
    return {
      day,
      at: point?.at ?? day * DAY,
      average: point?.average ?? null,
      kind: !point ? 'missing' : point.average === null ? 'no-sales' : 'price',
    }
  })
}
export function graphScale(days: TimelineDay[]): { min: number; max: number } {
  const values = days.flatMap(day =>
    day.average === null ? [] : [day.average],
  )
  if (!values.length) return { min: 0, max: 1 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const padding = Math.max(1, (max - min) * 0.15, max === min ? max * 0.05 : 0)
  const lower = Math.max(0, min - padding)
  const upper = max + padding
  const unit = 10 ** Math.floor(Math.log10((upper - lower) / 2))
  const ratio = (upper - lower) / 2 / unit
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * unit
  return {
    min: Math.floor(lower / step) * step,
    max: Math.ceil(upper / step) * step,
  }
}
const money = (value: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value)
const dayDate = (at: number) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(at)
export function timelineLabel(point: TimelineDay): string {
  const date = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(point.at)
  return point.kind === 'missing'
    ? `${date} UTC · jour non observé`
    : point.kind === 'no-sales'
      ? `${date} UTC · lecture sans données de vente`
      : `${date} UTC · ${money(point.average as number)} W · lu à ${new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(point.at)} UTC`
}
export function createPriceGraph(points: Observation[]): HTMLElement {
  const days = priceTimeline(points)
  const wrapper = document.createElement('div')
  wrapper.className = 'wm-price-graph'
  const heading = document.createElement('h3')
  heading.textContent = 'Évolution observée'
  const readout = document.createElement('p')
  readout.className = 'wm-note wm-graph-readout'
  readout.setAttribute('role', 'status')
  readout.textContent =
    'Survolez un jour ou utilisez ← →, Début et Fin au clavier.'
  if (!days.length) {
    readout.textContent = 'Aucune observation locale pour le moment'
    wrapper.append(heading, readout)
    return wrapper
  }
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 360 164')
  svg.setAttribute('role', 'group')
  svg.setAttribute(
    'aria-label',
    'Historique local des prix en W, par jour UTC ; navigation par flèches',
  )
  const add = (
    tag: string,
    attrs: Record<string, string>,
    text?: string,
  ): SVGElement => {
    const node = document.createElementNS(ns, tag)
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, value)
    if (text) node.textContent = text
    svg.append(node)
    return node
  }
  const scale = graphScale(days)
  const x = (i: number) =>
    64 + 278 * (days.length === 1 ? 0.5 : i / (days.length - 1))
  const y = (average: number) =>
    110 - (90 * (average - scale.min)) / (scale.max - scale.min)
  for (const value of days.some(day => day.kind === 'price')
    ? [scale.min, (scale.min + scale.max) / 2, scale.max]
    : []) {
    add('line', {
      x1: '64',
      x2: '342',
      y1: String(y(value)),
      y2: String(y(value)),
      class: 'wm-graph-grid',
    })
    add(
      'text',
      {
        x: '58',
        y: String(y(value) + 3),
        'text-anchor': 'end',
        class: 'wm-graph-axis',
      },
      money(value),
    )
  }
  add('text', { x: '64', y: '12', class: 'wm-graph-axis' }, 'W')
  add(
    'text',
    { x: '64', y: '158', class: 'wm-graph-axis' },
    dayDate(days[0].at),
  )
  add(
    'text',
    { x: '342', y: '158', 'text-anchor': 'end', class: 'wm-graph-axis' },
    `${dayDate(days.at(-1)?.at ?? 0)} UTC`,
  )
  const controls: SVGElement[] = []
  for (const [index, day] of days.entries()) {
    const previous = days[index - 1]
    if (day.average !== null && previous?.average != null)
      add('line', {
        x1: String(x(index - 1)),
        y1: String(y(previous.average)),
        x2: String(x(index)),
        y2: String(y(day.average)),
        class: 'wm-graph-line',
      })
    const control = add('g', {
      tabindex: index === 0 ? '0' : '-1',
      role: 'img',
      'aria-label': timelineLabel(day),
      class: 'wm-graph-day',
      'data-kind': day.kind,
    })
    const shape = document.createElementNS(
      ns,
      day.kind === 'no-sales'
        ? 'rect'
        : day.kind === 'missing'
          ? 'path'
          : 'circle',
    )
    const attrs =
      day.kind === 'no-sales'
        ? { x: String(x(index) - 3), y: '130', width: '6', height: '6' }
        : day.kind === 'missing'
          ? { d: `M ${x(index) - 3} 133 H ${x(index) + 3}` }
          : {
              cx: String(x(index)),
              cy: String(y(day.average as number)),
              r: '3.5',
            }
    for (const [key, value] of Object.entries(attrs))
      shape.setAttribute(key, value)
    control.append(shape)
    const hit = document.createElementNS(ns, 'circle')
    hit.setAttribute('cx', String(x(index)))
    hit.setAttribute(
      'cy',
      day.average === null ? '133' : String(y(day.average)),
    )
    hit.setAttribute('r', '7')
    hit.setAttribute('fill', 'transparent')
    hit.setAttribute('stroke', 'none')
    control.append(hit)
    const title = document.createElementNS(ns, 'title')
    title.textContent = timelineLabel(day)
    control.append(title)
    const show = () => {
      readout.textContent = timelineLabel(day)
      for (const [i, node] of controls.entries())
        node.setAttribute('tabindex', i === index ? '0' : '-1')
    }
    control.addEventListener('focus', show)
    control.addEventListener('mouseenter', show)
    control.addEventListener('keydown', event => {
      const key = (event as KeyboardEvent).key
      const next =
        key === 'ArrowRight'
          ? Math.min(days.length - 1, index + 1)
          : key === 'ArrowLeft'
            ? Math.max(0, index - 1)
            : key === 'Home'
              ? 0
              : key === 'End'
                ? days.length - 1
                : null
      if (next === null) return
      event.preventDefault()
      ;(controls[next] as SVGElement & { focus: () => void }).focus()
    })
    controls.push(control)
  }
  const legend = document.createElement('p')
  legend.className = 'wm-note'
  legend.textContent =
    '● Prix observé · □ Lecture sans données de vente · — Jour non observé'
  const caption = document.createElement('p')
  caption.className = 'wm-note'
  caption.textContent = `${days.filter(day => day.kind !== 'missing').length} observations locales · ${days.filter(day => day.kind === 'missing').length} jours non observés · ${days.filter(day => day.kind === 'no-sales').length} lectures sans données de vente · aucune interpolation`
  wrapper.append(heading, svg, readout, legend, caption)
  return wrapper
}
