/** Network unit tests leave the separately tested native UI adapter unmounted. */
export function nativeMarketStubs(window) {
  window.addEventListener ??= () => {}
  return {
    document: {
      body: null,
      querySelector: () => null,
      addEventListener: () => {},
    },
    MutationObserver: class {
      observe() {}
    },
    requestAnimationFrame: () => {},
  }
}
