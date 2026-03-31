(() => {
  const READY_BADGE_TEXT = 'PGN';
  const READY_BADGE_COLOR = '#2e7d32';
  const RETRY_BADGE_TEXT = '↺';
  const RETRY_BADGE_COLOR = '#f9a825';
  const ERROR_BADGE_TEXT = '!';
  const ERROR_BADGE_COLOR = '#c62828';
  const LICHESS_PASTE_URL = 'https://lichess.org/paste';

  type RuntimeResponse = OperationResponse | GetPendingImportResponse;

  interface SendChessTabMessageOptions {
    injectOnMissingReceiver?: boolean;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function getErrorMessage(error: unknown, fallbackMessage: string): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallbackMessage;
  }

  function isSupportedChessUrl(url: string | undefined): boolean {
    if (!url) {
      return false;
    }

    return /^https:\/\/www\.chess\.com\/game(?:\/live)?\//.test(url);
  }

  function isMissingReceiverError(error: unknown): boolean {
    return /receiving end does not exist/i.test(getErrorMessage(error, ''));
  }

  function isMissingTabError(error: unknown): boolean {
    return /no tab with id/i.test(getErrorMessage(error, ''));
  }

  function isPageStatusMessage(message: unknown): message is PageStatusMessage {
    return isRecord(message) && message.type === 'PAGE_STATUS' && typeof message.ready === 'boolean';
  }

  function isOpenLichessImportMessage(message: unknown): message is OpenLichessImportMessage {
    return (
      isRecord(message) &&
      message.type === 'OPEN_LICHESS_IMPORT' &&
      typeof message.pgn === 'string' &&
      typeof message.sourceUrl === 'string'
    );
  }

  function isGetPendingImportMessage(message: unknown): message is GetPendingImportMessage {
    return (
      isRecord(message) &&
      message.type === 'GET_PENDING_IMPORT' &&
      typeof message.importId === 'string'
    );
  }

  function isClearPendingImportMessage(message: unknown): message is ClearPendingImportMessage {
    return (
      isRecord(message) &&
      message.type === 'CLEAR_PENDING_IMPORT' &&
      typeof message.importId === 'string'
    );
  }

  function isPendingImport(value: unknown): value is PendingImport {
    return (
      isRecord(value) &&
      typeof value.pgn === 'string' &&
      typeof value.sourceUrl === 'string' &&
      typeof value.createdAt === 'number'
    );
  }

  function isGetStatusResponse(response: unknown): response is GetStatusResponse {
    return isRecord(response) && typeof response.ready === 'boolean';
  }

  function isOperationResponse(response: unknown): response is OperationResponse {
    return (
      isRecord(response) &&
      typeof response.ok === 'boolean' &&
      (response.error === undefined || typeof response.error === 'string')
    );
  }

  function getPendingImportStorageKey(importId: string): string {
    return `pending-import:${importId}`;
  }

  async function ignoreMissingTabError<T>(callback: () => Promise<T>): Promise<T | undefined> {
    try {
      return await callback();
    } catch (error) {
      if (isMissingTabError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  async function tryGetTab(tabId: number): Promise<chrome.tabs.Tab | null> {
    try {
      return await chrome.tabs.get(tabId);
    } catch (error) {
      if (isMissingTabError(error)) {
        return null;
      }

      throw error;
    }
  }

  async function clearBadge(tabId: number): Promise<void> {
    await ignoreMissingTabError(async () => {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
      await chrome.action.setTitle({
        tabId,
        title: 'Import Chess.com game to Lichess'
      });
    });
  }

  async function disableAction(tabId: number): Promise<void> {
    await ignoreMissingTabError(async () => {
      await chrome.action.disable(tabId);
    });
    await clearBadge(tabId);
  }

  async function enableAction(tabId: number): Promise<void> {
    await ignoreMissingTabError(async () => {
      await chrome.action.enable(tabId);
    });
  }

  async function setReadyBadge(tabId: number): Promise<void> {
    await ignoreMissingTabError(async () => {
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
    });
  }

  async function setRetryBadge(tabId: number, title?: string): Promise<void> {
    await ignoreMissingTabError(async () => {
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#1f1f1f' });
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: RETRY_BADGE_COLOR
      });
      await chrome.action.setBadgeText({ tabId, text: RETRY_BADGE_TEXT });
      await chrome.action.setTitle({
        tabId,
        title: title ?? 'PGN is not ready yet. Click to try importing again.'
      });
    });
  }

  async function setErrorBadge(tabId: number, title?: string): Promise<void> {
    await ignoreMissingTabError(async () => {
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: ERROR_BADGE_COLOR
      });
      await chrome.action.setBadgeText({ tabId, text: ERROR_BADGE_TEXT });
      await chrome.action.setTitle({
        tabId,
        title: title ?? 'Could not import the current Chess.com game'
      });
    });
  }

  async function ensureChessContentScript(tabId: number): Promise<void> {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['dist/chess-com.js']
    });
  }

  async function sendChessTabMessage(
    tabId: number,
    message: ChessTabRequest,
    options: SendChessTabMessageOptions = {}
  ): Promise<unknown> {
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

  async function refreshTabStatus(tabId: number, url: string | undefined): Promise<void> {
    if (!isSupportedChessUrl(url)) {
      await disableAction(tabId);
      return;
    }

    await enableAction(tabId);

    try {
      const response = await sendChessTabMessage(tabId, { type: 'GET_STATUS' });

      if (isGetStatusResponse(response) && response.ready) {
        await setReadyBadge(tabId);
        return;
      }
    } catch {
      await setRetryBadge(tabId);
      return;
    }

    await setRetryBadge(tabId);
  }

  async function handleTabActivated(tabId: number): Promise<void> {
    const tab = await tryGetTab(tabId);

    if (!tab) {
      return;
    }

    await refreshTabStatus(tabId, tab.url);
  }

  async function handleTabUpdated(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ): Promise<void> {
    if (!changeInfo.url && changeInfo.status !== 'complete') {
      return;
    }

    await refreshTabStatus(tabId, changeInfo.url ?? tab.url);
  }

  async function handleOpenLichessImportMessage(
    message: OpenLichessImportMessage
  ): Promise<OperationResponse> {
    const importId = crypto.randomUUID();
    const storageKey = getPendingImportStorageKey(importId);
    const pendingImport = {
      pgn: message.pgn,
      sourceUrl: message.sourceUrl,
      createdAt: Date.now()
    } satisfies PendingImport;

    await chrome.storage.session.set({
      [storageKey]: pendingImport
    });

    await chrome.tabs.create({
      url: `${LICHESS_PASTE_URL}#chesscom-import=${encodeURIComponent(importId)}`
    });

    return { ok: true };
  }

  async function handleGetPendingImportMessage(
    message: GetPendingImportMessage
  ): Promise<GetPendingImportResponse> {
    const importId = message.importId.trim();

    if (!importId) {
      return { ok: false, error: 'Missing import id.' };
    }

    const storageKey = getPendingImportStorageKey(importId);
    const result = await chrome.storage.session.get(storageKey);
    const pendingImport = result[storageKey];

    if (pendingImport === undefined) {
      return { ok: true, pendingImport: null };
    }

    if (!isPendingImport(pendingImport)) {
      await chrome.storage.session.remove(storageKey);
      return { ok: false, error: 'Pending import data is invalid.' };
    }

    return { ok: true, pendingImport };
  }

  async function handleClearPendingImportMessage(
    message: ClearPendingImportMessage
  ): Promise<OperationResponse> {
    const importId = message.importId.trim();

    if (!importId) {
      return { ok: false, error: 'Missing import id.' };
    }

    await chrome.storage.session.remove(getPendingImportStorageKey(importId));
    return { ok: true };
  }

  async function handleRuntimeMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<RuntimeResponse> {
    if (isPageStatusMessage(message)) {
      const tabId = sender.tab?.id;

      if (typeof tabId !== 'number') {
        return { ok: false, error: 'Message did not originate from a tab.' };
      }

      if (message.ready) {
        await setReadyBadge(tabId);
      } else {
        await setRetryBadge(tabId);
      }

      return { ok: true };
    }

    if (isOpenLichessImportMessage(message)) {
      return handleOpenLichessImportMessage(message);
    }

    if (isGetPendingImportMessage(message)) {
      return handleGetPendingImportMessage(message);
    }

    if (isClearPendingImportMessage(message)) {
      return handleClearPendingImportMessage(message);
    }

    return { ok: false, error: 'Unsupported message.' };
  }

  async function respondToRuntimeMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse) => void
  ): Promise<void> {
    try {
      sendResponse(await handleRuntimeMessage(message, sender));
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Unknown error');
      const tabId = sender.tab?.id;

      if (typeof tabId === 'number') {
        await setErrorBadge(tabId, errorMessage);
      }

      sendResponse({ ok: false, error: errorMessage });
    }
  }

  async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
    if (typeof tab.id !== 'number') {
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

      if (isOperationResponse(response) && response.ok) {
        await setReadyBadge(tab.id);
        return;
      }

      const errorMessage =
        isOperationResponse(response) && response.error
          ? response.error
          : 'Could not extract PGN from the page';

      if (/share button was not found|share modal did not open|pgn tab was not found|pgn text field was not found|pgn text was empty/i.test(errorMessage)) {
        await setRetryBadge(tab.id, errorMessage);
        return;
      }

      await setErrorBadge(tab.id, errorMessage);
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Could not reach the Chess.com page');

      if (/share button was not found|share modal did not open|pgn tab was not found|pgn text field was not found|pgn text was empty/i.test(errorMessage)) {
        await setRetryBadge(tab.id, errorMessage);
        return;
      }

      await setErrorBadge(tab.id, errorMessage);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    void chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void handleTabActivated(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    void handleTabUpdated(tabId, changeInfo, tab);
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void respondToRuntimeMessage(message, sender, sendResponse);
    return true;
  });

  chrome.action.onClicked.addListener(tab => {
    void handleActionClick(tab);
  });
})();