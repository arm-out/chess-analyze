"use strict";
(() => {
    const HASH_PREFIX = "#chesscom-import=";
    const PGN_TEXTAREA_SELECTOR = 'textarea[name="pgn"]';
    const CPU_ANALYZE_SELECTOR = 'input[name="analyse"]';
    const IMPORT_FORM_SELECTOR = 'main form[action="/import"]';
    function isRecord(value) {
        return typeof value === "object" && value !== null;
    }
    function isPendingImport(value) {
        return (isRecord(value) &&
            typeof value.pgn === "string" &&
            typeof value.sourceUrl === "string" &&
            typeof value.createdAt === "number");
    }
    function isGetPendingImportResponse(response) {
        if (!isRecord(response) || typeof response.ok !== "boolean") {
            return false;
        }
        if (!response.ok) {
            return (response.error === undefined ||
                typeof response.error === "string");
        }
        return (response.pendingImport === null ||
            isPendingImport(response.pendingImport));
    }
    function getImportId() {
        if (!window.location.hash.startsWith(HASH_PREFIX)) {
            return null;
        }
        return decodeURIComponent(window.location.hash.slice(HASH_PREFIX.length));
    }
    function wait(milliseconds) {
        return new Promise((resolve) => {
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
    function setTextareaValue(textarea, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (valueSetter) {
            valueSetter.call(textarea, value);
        }
        else {
            textarea.value = value;
        }
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function setCPUAnalyzeOption(enabled) {
        const cpuAnalyzeOption = document.querySelector(CPU_ANALYZE_SELECTOR);
        if (cpuAnalyzeOption) {
            cpuAnalyzeOption.checked = enabled;
        }
    }
    async function importPendingPgn() {
        try {
            const importId = getImportId();
            if (!importId) {
                return;
            }
            const form = await waitForElement(IMPORT_FORM_SELECTOR, 5000);
            const textarea = await waitForElement(PGN_TEXTAREA_SELECTOR, 5000);
            if (!form || !textarea) {
                return;
            }
            const response = await chrome.runtime.sendMessage({
                type: "GET_PENDING_IMPORT",
                importId,
            });
            if (!isGetPendingImportResponse(response) ||
                !response.ok ||
                response.pendingImport === null) {
                return;
            }
            setTextareaValue(textarea, response.pendingImport.pgn);
            setCPUAnalyzeOption(true);
            await chrome.runtime.sendMessage({
                type: "CLEAR_PENDING_IMPORT",
                importId,
            });
            window.history.replaceState({}, document.title, window.location.pathname);
            form.requestSubmit();
        }
        catch {
            return;
        }
    }
    void importPendingPgn();
})();
