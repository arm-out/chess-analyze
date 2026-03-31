"use strict";
(() => {
    const SELECTORS = {
        shareButton: 'button[data-cy="sidebar-share-icon"]',
        shareModal: '[data-cy="share-menu-modal"]',
        pgnTab: 'button[data-cy="pgn-tab-button"]',
        pgnTextarea: '[data-cy="share-menu-modal"] textarea[aria-label="PGN"]',
        modalCloseButtons: [
            '[data-cy="share-menu-modal"] button[aria-label="Close"]',
            '[data-cy="share-menu-modal"] button[aria-label="close"]',
            '[data-cy="share-menu-modal"] [data-cy="modal-close-button"]',
            '[data-cy="share-menu-modal"] .cc-modal-close-button'
        ]
    };
    let lastReportedReady = null;
    let statusTimerId = null;
    function isRecord(value) {
        return typeof value === 'object' && value !== null;
    }
    function getErrorMessage(error, fallbackMessage) {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        return fallbackMessage;
    }
    function isGetStatusRequest(message) {
        return isRecord(message) && message.type === 'GET_STATUS';
    }
    function isStartImportRequest(message) {
        return isRecord(message) && message.type === 'START_IMPORT';
    }
    function isOperationResponse(response) {
        return (isRecord(response) &&
            typeof response.ok === 'boolean' &&
            (response.error === undefined || typeof response.error === 'string'));
    }
    function isReady() {
        return document.querySelector(SELECTORS.shareButton) !== null;
    }
    function wait(milliseconds) {
        return new Promise(resolve => {
            window.setTimeout(resolve, milliseconds);
        });
    }
    async function waitForElement(selector, timeoutMs = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
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
        }
        catch {
            return;
        }
    }
    function scheduleStatusReport() {
        if (statusTimerId !== null) {
            window.clearTimeout(statusTimerId);
        }
        statusTimerId = window.setTimeout(() => {
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
        const pgn = pgnTextarea.value.trim();
        if (!pgn) {
            throw new Error('PGN text was empty.');
        }
        return pgn;
    }
    async function closeShareModal() {
        const modal = document.querySelector(SELECTORS.shareModal);
        if (!modal) {
            return;
        }
        for (const selector of SELECTORS.modalCloseButtons) {
            const closeButton = document.querySelector(selector);
            if (!closeButton) {
                continue;
            }
            closeButton.click();
            const modalStillOpen = await waitForElement(SELECTORS.shareModal, 400);
            if (!modalStillOpen) {
                return;
            }
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
        await wait(100);
    }
    async function startImport() {
        const pgn = await extractPgn();
        await closeShareModal();
        const response = await chrome.runtime.sendMessage({
            type: 'OPEN_LICHESS_IMPORT',
            pgn,
            sourceUrl: window.location.href
        });
        if (isOperationResponse(response) && response.ok) {
            return;
        }
        const errorMessage = isOperationResponse(response) && response.error
            ? response.error
            : 'Could not open the Lichess import page.';
        throw new Error(errorMessage);
    }
    async function handleMessage(message, sendResponse) {
        if (isGetStatusRequest(message)) {
            sendResponse({ ready: isReady() });
            return;
        }
        if (isStartImportRequest(message)) {
            await startImport();
            sendResponse({ ok: true });
            return;
        }
        sendResponse({ ok: false, error: 'Unsupported message.' });
    }
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        void handleMessage(message, sendResponse).catch(error => {
            sendResponse({ ok: false, error: getErrorMessage(error, 'Unknown error') });
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
})();
