const READY_BADGE_TEXT = 'PGN';
const READY_BADGE_COLOR = '#2e7d32';
const ERROR_BADGE_TEXT = '!';
const ERROR_BADGE_COLOR = '#c62828';
const RELAY_PAGE = 'relay.html';

function isSupportedChessUrl(url) {
  if (!url) {
    return false;
  }

  return /^https:\/\/www\.chess\.com\/game(?:\/live)?\//.test(url);
}

async function clearBadge(tabId) {
  await chrome.action.setBadgeText({ tabId, text: '' });
  await chrome.action.setTitle({
    tabId,
    title: 'Import Chess.com game to Lichess'
  });
}

async function setReadyBadge(tabId) {
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

async function setErrorBadge(tabId, title) {
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

async function refreshTabStatus(tabId, url) {
  if (!isSupportedChessUrl(url)) {
    await clearBadge(tabId);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_STATUS' });

    if (response?.ready) {
      await setReadyBadge(tabId);
      return;
    }
  } catch {
    // Ignore missing content script during navigation.
  }

  await clearBadge(tabId);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  await refreshTabStatus(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') {
    return;
  }

  await refreshTabStatus(tabId, tab.url);
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
        await clearBadge(tabId);
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

      const relayUrl = chrome.runtime.getURL(`${RELAY_PAGE}?id=${encodeURIComponent(importId)}`);
      await chrome.tabs.create({ url: relayUrl });

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
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_IMPORT' });

    if (!response?.ok) {
      await setErrorBadge(tab.id, response?.error || 'Could not extract PGN from the page');
      return;
    }

    await setReadyBadge(tab.id);
  } catch (error) {
    await setErrorBadge(tab.id, error?.message || 'Could not reach the Chess.com page');
  }
});