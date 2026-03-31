"use strict";
(() => {
    const READY_BADGE_TEXT = 'PGN';
    const READY_BADGE_COLOR = '#2e7d32';
    const RETRY_BADGE_TEXT = '↺';
    const RETRY_BADGE_COLOR = '#f9a825';
    const ERROR_BADGE_TEXT = '!';
    const ERROR_BADGE_COLOR = '#c62828';
    const LICHESS_PASTE_URL = 'https://lichess.org/paste';
    function isRecord(value) {
        return typeof value === 'object' && value !== null;
    }
    function getErrorMessage(error, fallbackMessage) {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        return fallbackMessage;
    }
    function isSupportedChessUrl(url) {
        if (!url) {
            return false;
        }
        return /^https:\/\/www\.chess\.com\/game(?:\/live)?\//.test(url);
    }
    function isMissingReceiverError(error) {
        return /receiving end does not exist/i.test(getErrorMessage(error, ''));
    }
    function isMissingTabError(error) {
        return /no tab with id/i.test(getErrorMessage(error, ''));
    }
    function isPageStatusMessage(message) {
        return isRecord(message) && message.type === 'PAGE_STATUS' && typeof message.ready === 'boolean';
    }
    function isOpenLichessImportMessage(message) {
        return (isRecord(message) &&
            message.type === 'OPEN_LICHESS_IMPORT' &&
            typeof message.pgn === 'string' &&
            typeof message.sourceUrl === 'string');
    }
    function isGetPendingImportMessage(message) {
        return (isRecord(message) &&
            message.type === 'GET_PENDING_IMPORT' &&
            typeof message.importId === 'string');
    }
    function isClearPendingImportMessage(message) {
        return (isRecord(message) &&
            message.type === 'CLEAR_PENDING_IMPORT' &&
            typeof message.importId === 'string');
    }
    function isPendingImport(value) {
        return (isRecord(value) &&
            typeof value.pgn === 'string' &&
            typeof value.sourceUrl === 'string' &&
            typeof value.createdAt === 'number');
    }
    function isGetStatusResponse(response) {
        return isRecord(response) && typeof response.ready === 'boolean';
    }
    function isOperationResponse(response) {
        return (isRecord(response) &&
            typeof response.ok === 'boolean' &&
            (response.error === undefined || typeof response.error === 'string'));
    }
    function getPendingImportStorageKey(importId) {
        return `pending-import:${importId}`;
    }
    async function ignoreMissingTabError(callback) {
        try {
            return await callback();
        }
        catch (error) {
            if (isMissingTabError(error)) {
                return undefined;
            }
            throw error;
        }
    }
    async function tryGetTab(tabId) {
        try {
            return await chrome.tabs.get(tabId);
        }
        catch (error) {
            if (isMissingTabError(error)) {
                return null;
            }
            throw error;
        }
    }
    async function clearBadge(tabId) {
        await ignoreMissingTabError(async () => {
            await chrome.action.setBadgeText({ tabId, text: '' });
            await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
            await chrome.action.setTitle({
                tabId,
                title: 'Import Chess.com game to Lichess'
            });
        });
    }
    async function disableAction(tabId) {
        await ignoreMissingTabError(async () => {
            await chrome.action.disable(tabId);
        });
        await clearBadge(tabId);
    }
    async function enableAction(tabId) {
        await ignoreMissingTabError(async () => {
            await chrome.action.enable(tabId);
        });
    }
    async function setReadyBadge(tabId) {
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
    async function setRetryBadge(tabId, title) {
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
    async function setErrorBadge(tabId, title) {
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
    async function ensureChessContentScript(tabId) {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['dist/chess-com.js']
        });
    }
    async function sendChessTabMessage(tabId, message, options = {}) {
        const { injectOnMissingReceiver = false } = options;
        try {
            return await chrome.tabs.sendMessage(tabId, message);
        }
        catch (error) {
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
            if (isGetStatusResponse(response) && response.ready) {
                await setReadyBadge(tabId);
                return;
            }
        }
        catch {
            await setRetryBadge(tabId);
            return;
        }
        await setRetryBadge(tabId);
    }
    async function handleTabActivated(tabId) {
        const tab = await tryGetTab(tabId);
        if (!tab) {
            return;
        }
        await refreshTabStatus(tabId, tab.url);
    }
    async function handleTabUpdated(tabId, changeInfo, tab) {
        if (!changeInfo.url && changeInfo.status !== 'complete') {
            return;
        }
        await refreshTabStatus(tabId, changeInfo.url ?? tab.url);
    }
    async function handleOpenLichessImportMessage(message) {
        const importId = crypto.randomUUID();
        const storageKey = getPendingImportStorageKey(importId);
        const pendingImport = {
            pgn: message.pgn,
            sourceUrl: message.sourceUrl,
            createdAt: Date.now()
        };
        await chrome.storage.session.set({
            [storageKey]: pendingImport
        });
        await chrome.tabs.create({
            url: `${LICHESS_PASTE_URL}#chesscom-import=${encodeURIComponent(importId)}`
        });
        return { ok: true };
    }
    async function handleGetPendingImportMessage(message) {
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
    async function handleClearPendingImportMessage(message) {
        const importId = message.importId.trim();
        if (!importId) {
            return { ok: false, error: 'Missing import id.' };
        }
        await chrome.storage.session.remove(getPendingImportStorageKey(importId));
        return { ok: true };
    }
    async function handleRuntimeMessage(message, sender) {
        if (isPageStatusMessage(message)) {
            const tabId = sender.tab?.id;
            if (typeof tabId !== 'number') {
                return { ok: false, error: 'Message did not originate from a tab.' };
            }
            if (message.ready) {
                await setReadyBadge(tabId);
            }
            else {
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
    async function respondToRuntimeMessage(message, sender, sendResponse) {
        try {
            sendResponse(await handleRuntimeMessage(message, sender));
        }
        catch (error) {
            const errorMessage = getErrorMessage(error, 'Unknown error');
            const tabId = sender.tab?.id;
            if (typeof tabId === 'number') {
                await setErrorBadge(tabId, errorMessage);
            }
            sendResponse({ ok: false, error: errorMessage });
        }
    }
    async function handleActionClick(tab) {
        if (typeof tab.id !== 'number') {
            return;
        }
        if (!isSupportedChessUrl(tab.url)) {
            await clearBadge(tab.id);
            return;
        }
        try {
            const response = await sendChessTabMessage(tab.id, { type: 'START_IMPORT' }, { injectOnMissingReceiver: true });
            if (isOperationResponse(response) && response.ok) {
                await setReadyBadge(tab.id);
                return;
            }
            const errorMessage = isOperationResponse(response) && response.error
                ? response.error
                : 'Could not extract PGN from the page';
            if (/share button was not found|share modal did not open|pgn tab was not found|pgn text field was not found|pgn text was empty/i.test(errorMessage)) {
                await setRetryBadge(tab.id, errorMessage);
                return;
            }
            await setErrorBadge(tab.id, errorMessage);
        }
        catch (error) {
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
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        void respondToRuntimeMessage(message, sender, sendResponse);
        return true;
    });
    chrome.action.onClicked.addListener(tab => {
        void handleActionClick(tab);
    });
})();
