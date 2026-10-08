// Synthetic Phase 0 experiment; no workspace data, remote resources, or command URIs.
(() => {
  const vscode = acquireVsCodeApi();
  let cards = [];
  window.addEventListener('message', event => {
    if (event.data?.type !== 'cards' || !Array.isArray(event.data.cards)) { return; }
    cards = event.data.cards;
    document.getElementById('status').textContent = 'Ready. References expire after two minutes; refocus to renew.';
  });
  for (const card of document.querySelectorAll('.card')) {
    card.addEventListener('dragstart', event => {
      const index = Number(card.dataset.index);
      const data = cards[index];
      if (!data || !event.dataTransfer) { event.preventDefault(); return; }
      const payload = document.getElementById('payload').value;
      const mime = payload === 'custom' ? 'application/vnd.turbo-code-palette.ux-lab'
        : payload === 'uri' ? 'text/uri-list' : 'text/plain';
      event.dataTransfer.setData(mime, payload === 'raw' ? data.text : data.reference);
      event.dataTransfer.effectAllowed = 'copy';
      vscode.postMessage({ type: 'drag', index, payload });
    });
    card.addEventListener('dragend', () => vscode.postMessage({ type: 'renew' }));
  }
  for (const button of document.querySelectorAll('[data-insert]')) {
    button.addEventListener('click', () => vscode.postMessage({ type: 'insert', index: Number(button.dataset.insert) }));
  }
  window.addEventListener('focus', () => vscode.postMessage({ type: 'renew' }));
  vscode.postMessage({ type: 'ready' });
})();
