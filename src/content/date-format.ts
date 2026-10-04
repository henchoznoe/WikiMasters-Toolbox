/** Bern local time, including Swiss summer/winter offsets, independent of the browser. */
export const BERN_TIME_ZONE = 'Europe/Zurich'

const date = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeZone: BERN_TIME_ZONE,
})
const time = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: BERN_TIME_ZONE,
  timeZoneName: 'shortOffset',
})
const short = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: BERN_TIME_ZONE,
})
export const formatDate = (at: number): string => date.format(at)
export const formatTime = (at: number): string => time.format(at)
export const formatDateTime = (at: number): string =>
  `${formatDate(at)}, ${formatTime(at)}`
export const shortDate = (at: number): string => short.format(at)
