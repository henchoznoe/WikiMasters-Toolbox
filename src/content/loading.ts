/** Keep the animation stable across repeated renders and expose a text alternative. */
export function setLoadingText(
  node: HTMLElement,
  text: string,
  loading: boolean,
): void {
  const signature = JSON.stringify([text, loading])
  if (node.dataset.loadingText === signature) return
  node.dataset.loadingText = signature
  node.setAttribute('aria-busy', String(loading))
  if (!loading) {
    node.textContent = text
    return
  }
  const spinner = document.createElement('span')
  spinner.className = 'wm-loader'
  spinner.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.textContent = text
  node.replaceChildren(spinner, label)
}
