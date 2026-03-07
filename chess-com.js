const SELECTORS = {
  shareButton: 'button[data-cy="sidebar-share-icon"]',
  shareModal: '[data-cy="share-menu-modal"]',
  pgnTab: 'button[data-cy="pgn-tab-button"]',
  pgnTextarea: '[data-cy="share-menu-modal"] textarea[aria-label="PGN"]'
};

let lastReportedReady = null;
let statusTimer = null;

function isReady() {
  return Boolean(document.querySelector(SELECTORS.shareButton));
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function waitForElement(selector, timeoutMs = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const element = document.querySelector(selector);

    if (element) {
      return element;
    }

    await wait(100);
  }

  return null;
}

async function reportStatus(force = false) {
  const ready = isReady();

  if (!force && ready === lastReportedReady) {
    return;
  }

  lastReportedReady = ready;

  try {
    await chrome.runtime.sendMessage({ type: 'PAGE_STATUS', ready });
  } catch {
    // Ignore transient extension messaging failures during navigation.
  }
}

function scheduleStatusReport() {
  if (statusTimer) {
    window.clearTimeout(statusTimer);
  }

  statusTimer = window.setTimeout(() => {
    void reportStatus();
  }, 150);
}

async function ensureShareModalOpen() {
  let modal = document.querySelector(SELECTORS.shareModal);

  if (modal) {
    return modal;
  }

  const shareButton = document.querySelector(SELECTORS.shareButton);

  if (!shareButton) {
    throw new Error('Share button was not found on this Chess.com page.');
  }

  shareButton.click();
  modal = await waitForElement(SELECTORS.shareModal, 5000);

  if (!modal) {
    throw new Error('Share modal did not open.');
  }

  return modal;
}

async function ensurePgnTabOpen() {
  const pgnTab = await waitForElement(SELECTORS.pgnTab, 5000);

  if (!pgnTab) {
    throw new Error('PGN tab was not found in the share modal.');
  }

  if (pgnTab.getAttribute('aria-selected') !== 'true') {
    pgnTab.click();
  }

  const pgnTextarea = await waitForElement(SELECTORS.pgnTextarea, 5000);

  if (!pgnTextarea) {
    throw new Error('PGN text field was not found.');
  }

  return pgnTextarea;
}

async function extractPgn() {
  await ensureShareModalOpen();
  const pgnTextarea = await ensurePgnTabOpen();
  const pgn = pgnTextarea.value?.trim();

  if (!pgn) {
    throw new Error('PGN text was empty.');
  }

  return pgn;
}

async function startImport() {
  const pgn = await extractPgn();
  const response = await chrome.runtime.sendMessage({
    type: 'OPEN_LICHESS_IMPORT',
    pgn,
    sourceUrl: window.location.href
  });

  if (!response?.ok) {
    throw new Error(response?.error || 'Could not open the Lichess import page.');
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message?.type === 'GET_STATUS') {
      sendResponse({ ready: isReady() });
      return;
    }

    if (message?.type === 'START_IMPORT') {
      await startImport();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false });
  })().catch(error => {
    sendResponse({ ok: false, error: error?.message || 'Unknown error' });
  });

  return true;
});

const observer = new MutationObserver(() => {
  scheduleStatusReport();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true
});

void reportStatus(true);