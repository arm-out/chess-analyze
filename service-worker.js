const READY_BADGE_TEXT = 'PGN';
const READY_BADGE_COLOR = '#2e7d32';
const RETRY_BADGE_TEXT = '↺';
const RETRY_BADGE_COLOR = '#f9a825';
const ERROR_BADGE_TEXT = '!';
const ERROR_BADGE_COLOR = '#c62828';
const LICHESS_PASTE_URL = 'https://lichess.org/paste';

function isSupportedChessUrl(url) {
  if (!url) {
    return false;
  }

  return /^https:\/\/www\.chess\.com\/game(?:\/live)?\//.test(url);
}

async function clearBadge(tabId) {
  await chrome.action.setBadgeText({ tabId, text: '' });
  await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
  await chrome.action.setTitle({
    tabId,
    title: 'Import Chess.com game to Lichess'
  });
}

async function disableAction(tabId) {
  await chrome.action.disable(tabId);
  await clearBadge(tabId);
}

async function enableAction(tabId) {
  await chrome.action.enable(tabId);
}

async function setReadyBadge(tabId) {
  await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: READY_BADGE_COLOR
  });
  await chrome.action.setBadgeText({ tabId, text: READY_BADGE_TEXT });
  await chrome.action.setTitle({
    tabId,
    title: 'Ready to import this Chess.com game to Lichess'
  });
}

async function setRetryBadge(tabId, title) {
  await chrome.action.setBadgeTextColor?.({ tabId, color: '#1f1f1f' });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: RETRY_BADGE_COLOR
  });
  await chrome.action.setBadgeText({ tabId, text: RETRY_BADGE_TEXT });
  await chrome.action.setTitle({
    tabId,
    title: title || 'PGN is not ready yet. Click to try importing again.'
  });
}

async function setErrorBadge(tabId, title) {
  await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: ERROR_BADGE_COLOR
  });
  await chrome.action.setBadgeText({ tabId, text: ERROR_BADGE_TEXT });
  await chrome.action.setTitle({
    tabId,
    title: title || 'Could not import the current Chess.com game'
  });
}

function isMissingReceiverError(error) {
  return /receiving end does not exist/i.test(error?.message || '');
}

function isRetryableImportError(message) {
  return /share button was not found|share modal did not open|pgn tab was not found|pgn text field was not found|pgn text was empty/i.test(
    message || ''
  );
}

async function ensureChessContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['chess-com.js']
  });
}

async function sendChessTabMessage(tabId, message, options = {}) {
  const { injectOnMissingReceiver = false } = options;

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!injectOnMissingReceiver || !isMissingReceiverError(error)) {
      throw error;
    }

    await ensureChessContentScript(tabId);
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function refreshTabStatus(tabId, url) {
  if (!isSupportedChessUrl(url)) {
    await disableAction(tabId);
    return;
  }

  await enableAction(tabId);

  try {
    const response = await sendChessTabMessage(tabId, { type: 'GET_STATUS' });

    if (response?.ready) {
      await setReadyBadge(tabId);
      return;
    }
  } catch {
    // Fall through to the retry state for supported pages.
  }

  await setRetryBadge(tabId);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await refreshTabStatus(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') {
    return;
  }

  await refreshTabStatus(tabId, changeInfo.url || tab.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    if (message?.type === 'PAGE_STATUS') {
      const tabId = sender.tab?.id;

      if (typeof tabId !== 'number') {
        sendResponse({ ok: false });
        return;
      }

      if (message.ready) {
        await setReadyBadge(tabId);
      } else {
        await setRetryBadge(tabId);
      }

      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'OPEN_LICHESS_IMPORT') {
      const importId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const storageKey = `pending-import:${importId}`;

      await chrome.storage.session.set({
        [storageKey]: {
          pgn: message.pgn,
          sourceUrl: message.sourceUrl,
          createdAt: Date.now()
        }
      });

      await chrome.tabs.create({
        url: `${LICHESS_PASTE_URL}#chesscom-import=${encodeURIComponent(importId)}`
      });

      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'GET_PENDING_IMPORT') {
      const importId = message.importId;

      if (!importId) {
        sendResponse({ ok: false, error: 'Missing import id.' });
        return;
      }

      const storageKey = `pending-import:${importId}`;
      const result = await chrome.storage.session.get(storageKey);
      sendResponse({ ok: true, pendingImport: result[storageKey] || null });
      return;
    }

    if (message?.type === 'CLEAR_PENDING_IMPORT') {
      const importId = message.importId;

      if (!importId) {
        sendResponse({ ok: false, error: 'Missing import id.' });
        return;
      }

      const storageKey = `pending-import:${importId}`;
      await chrome.storage.session.remove(storageKey);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false });
  })().catch(async error => {
    const tabId = sender.tab?.id;

    if (typeof tabId === 'number') {
      await setErrorBadge(tabId, error?.message);
    }

    sendResponse({ ok: false, error: error?.message || 'Unknown error' });
  });

  return true;
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) {
    return;
  }

  if (!isSupportedChessUrl(tab.url)) {
    await clearBadge(tab.id);
    return;
  }

  try {
    const response = await sendChessTabMessage(
      tab.id,
      { type: 'START_IMPORT' },
      { injectOnMissingReceiver: true }
    );

    if (!response?.ok) {
      const errorMessage = response?.error || 'Could not extract PGN from the page';

      if (isRetryableImportError(errorMessage)) {
        await setRetryBadge(tab.id, errorMessage);
        return;
      }

      await setErrorBadge(tab.id, errorMessage);
      return;
    }

    await setReadyBadge(tab.id);
  } catch (error) {
    const errorMessage = error?.message || 'Could not reach the Chess.com page';

    if (isRetryableImportError(errorMessage)) {
      await setRetryBadge(tab.id, errorMessage);
      return;
    }

    await setErrorBadge(tab.id, errorMessage);
  }
});