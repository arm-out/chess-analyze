function setStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const importId = params.get('id');

  if (!importId) {
    setStatus('Missing import id.', true);
    return;
  }

  const storageKey = `pending-import:${importId}`;
  const result = await chrome.storage.session.get(storageKey);
  const pendingImport = result[storageKey];

  if (!pendingImport?.pgn) {
    setStatus('PGN data was not found. Start the import again from Chess.com.', true);
    return;
  }

  await chrome.storage.session.remove(storageKey);

  const textarea = document.getElementById('pgn');
  const form = document.getElementById('import-form');

  textarea.value = pendingImport.pgn;
  setStatus('Submitting PGN to Lichess...');
  form.submit();
}

void main().catch(error => {
  setStatus(error?.message || 'Unexpected error while sending PGN to Lichess.', true);
});