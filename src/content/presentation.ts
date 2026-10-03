/** Translate internal state codes at the display boundary, preserving stored values. */
export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    idle: 'en attente',
    loading: 'chargement',
    paused: 'en pause',
    error: 'erreur',
    complete: 'complet',
    stale: 'ancien',
    free: 'libre',
    sale: 'en vente',
    trade: 'en échange',
    committed: 'engagée (copie indéterminée)',
    unknown: 'inconnu',
    pending: 'en attente',
    discarded: 'défaussée',
    failed: 'échec',
    listed: 'mise en vente',
    rejected: 'refusée',
  }
  return Object.hasOwn(labels, status) ? labels[status] : 'inconnu'
}

/** Render pre-translation receipts without rewriting account journals or native messages. */
export function storedMessage(message: string): string {
  const legacy: Record<string, string> = {
    '200 requests / hour reached': 'Limite de 200 requêtes / heure atteinte',
    'Action stopped: result could not be saved locally':
      'Action arrêtée : impossible d’enregistrer le résultat localement',
    'Action unavailable': 'Action indisponible',
    'An action is already running in another tab':
      'Une action est déjà en cours dans un autre onglet',
    'An action is running in another tab':
      'Une action est en cours dans un autre onglet',
    'Another tab is opening packs': 'Un autre onglet ouvre des paquets',
    'Browser locking unavailable': 'Verrouillage du navigateur indisponible',
    'Check this copy before confirming in the game':
      'Vérifiez cette copie avant de confirmer dans le jeu',
    'Checking available packs…': 'Vérification des paquets disponibles…',
    'Collection changed; check again':
      'Collection modifiée ; vérifiez à nouveau',
    'Collection changed; prepare a new preview':
      'Collection modifiée ; préparez un nouvel aperçu',
    'Complete collection unavailable': 'Collection complète indisponible',
    'Copy check failed': 'Vérification de la copie échouée',
    'Cross-tab lock unavailable': 'Verrou entre onglets indisponible',
    'Daily pack limit reached': 'Limite quotidienne de paquets atteinte',
    'Failed: the game could not open the next pack.':
      'Échec : le jeu n’a pas pu ouvrir le paquet suivant.',
    'Game rejected the sale · check again':
      'Vente refusée par le jeu · vérifiez à nouveau',
    'Game response changed; reload the page':
      'Réponse du jeu modifiée ; rechargez la page',
    'Group actions need browser locking support':
      'Les actions groupées nécessitent le verrouillage entre onglets',
    'Interrupted request; verify the collection':
      'Requête interrompue ; vérifiez la collection',
    'Invalid sale protection': 'Protection de vente invalide',
    'Invalid trade protection': 'Protection d’échange invalide',
    'Left the Packs page': 'Page des paquets quittée',
    'Load the complete collection first':
      'Chargez d’abord la collection complète',
    'No packs remain.': 'Il ne reste aucun paquet.',
    'No packs were available.': 'Aucun paquet disponible.',
    'Opening automatically…': 'Ouverture automatique…',
    'Opening stopped by the game rate limit':
      'Ouverture arrêtée par la limite de requêtes du jeu',
    'Opening stopped.': 'Ouverture arrêtée.',
    'Pack response changed': 'Réponse du paquet modifiée',
    'Page or account changed': 'Page ou compte modifié',
    'Protections changed; prepare a new preview':
      'Protections modifiées ; préparez un nouvel aperçu',
    'Protections unavailable': 'Protections indisponibles',
    'Read queue is full': 'File de lectures pleine',
    'Read unavailable': 'Lecture indisponible',
    'Rejected by the game': 'Refusé par le jeu',
    'Request stopped': 'Requête arrêtée',
    'Request timed out': 'Délai de requête dépassé',
    'Result unavailable': 'Résultat indisponible',
    'Result uncertain · verify in My sales':
      'Résultat incertain · vérifiez dans « Mes ventes »',
    'Result uncertain; verify the collection':
      'Résultat incertain ; vérifiez la collection',
    'Sale / trade protections unavailable':
      'Protections de vente / échange indisponibles',
    'Sale identity unavailable': 'Identité de vente indisponible',
    'Scheduled opening is due…': 'Ouverture programmée en attente…',
    'Session expired': 'Session expirée',
    'Stopped by user': 'Arrêt demandé',
    'Stopped from another tab': 'Arrêt depuis un autre onglet',
    'Temporary rate limit; try again later':
      'Limite temporaire de requêtes ; réessayez plus tard',
    'The game is busy. Retrying shortly…':
      'Le jeu est occupé. Nouvelle tentative bientôt…',
    'The game returned a pack without cards':
      'Le jeu a renvoyé un paquet sans cartes',
    'Trade account changed': 'Compte d’échange modifié',
    'Trade identity unavailable': 'Identité d’échange indisponible',
    'Trade items unavailable': 'Cartes de l’échange indisponibles',
    'Unexpected result; check the collection before another action':
      'Résultat inattendu ; vérifiez la collection avant une autre action',
    'Verification complete': 'Vérification terminée',
    'Verification required · use the game’s Open button':
      'Vérification requise · utilisez le bouton d’ouverture du jeu',
    'Waiting for your WikiMasters account…':
      'En attente de votre compte WikiMasters…',
    'WikiMasters account changed': 'Compte WikiMasters modifié',
    'WikiMasters account changed during the run':
      'Compte WikiMasters modifié pendant l’ouverture',
    'Write stopped before sending': 'Écriture arrêtée avant l’envoi',
  }
  if (Object.hasOwn(legacy, message)) return legacy[message]
  const limit = message.match(/^Reached your (\d+)-pack limit\.$/)
  if (limit) return `Limite atteinte : ${limit[1]} paquets.`
  const safety = message.match(/^Stopped at the (\d+)-pack safety limit\.$/)
  if (safety) return `Arrêt à la limite de sécurité de ${safety[1]} paquets.`
  const http = message.match(/^The game returned HTTP (\d+)$/)
  if (http) return `Le jeu a renvoyé HTTP ${http[1]}`
  if (message.startsWith('Failed: '))
    return `Échec : ${storedMessage(message.slice(8).replace(/\.$/, ''))}.`
  if (message.endsWith('.') && Object.hasOwn(legacy, message.slice(0, -1)))
    return `${legacy[message.slice(0, -1)]}.`
  return message
}

/** Browser transport exceptions use browser-language wording; show a stable French hint. */
export function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback
  if (cause.name === 'TypeError' || cause.name === 'NetworkError')
    return 'Erreur réseau ; réessayez plus tard'
  return storedMessage(cause.message)
}
