const selector = '.el-input-number input[role="spinbutton"]'

// Current Element Plus updates native disabled but leaves its mounted ARIA value stale.
export function installInputNumberAccessibility(root: HTMLElement): () => void {
  function sync(input: HTMLInputElement) {
    const disabled = String(input.disabled)
    if (input.getAttribute('aria-disabled') !== disabled)
      input.setAttribute('aria-disabled', disabled)
  }
  function syncAdded(node: Node) {
    if (!(node instanceof Element)) return
    if (node.matches(selector)) sync(node as HTMLInputElement)
    node.querySelectorAll<HTMLInputElement>(selector).forEach(sync)
  }
  syncAdded(root)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(syncAdded)
      else if (record.target instanceof HTMLInputElement && record.target.matches(selector))
        sync(record.target)
    }
  })
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled'],
  })
  return () => observer.disconnect()
}
