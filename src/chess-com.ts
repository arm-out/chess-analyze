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
  } as const;

  type ChessComResponse = GetStatusResponse | OperationResponse;

  let lastReportedReady: boolean | null = null;
  let statusTimerId: number | null = null;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function getErrorMessage(error: unknown, fallbackMessage: string): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallbackMessage;
  }

  function isGetStatusRequest(message: unknown): message is GetStatusRequest {
    return isRecord(message) && message.type === 'GET_STATUS';
  }

  function isStartImportRequest(message: unknown): message is StartImportRequest {
    return isRecord(message) && message.type === 'START_IMPORT';
  }

  function isOperationResponse(response: unknown): response is OperationResponse {
    return (
      isRecord(response) &&
      typeof response.ok === 'boolean' &&
      (response.error === undefined || typeof response.error === 'string')
    );
  }

  function isReady(): boolean {
    return document.querySelector(SELECTORS.shareButton) !== null;
  }

  function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function waitForElement<TElement extends Element>(
    selector: string,
    timeoutMs = 5000
  ): Promise<TElement | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const element = document.querySelector<TElement>(selector);

      if (element) {
        return element;
      }

      await wait(100);
    }

    return null;
  }

  async function reportStatus(force = false): Promise<void> {
    const ready = isReady();

    if (!force && ready === lastReportedReady) {
      return;
    }

    lastReportedReady = ready;

    try {
      await chrome.runtime.sendMessage({ type: 'PAGE_STATUS', ready } satisfies PageStatusMessage);
    } catch {
      return;
    }
  }

  function scheduleStatusReport(): void {
    if (statusTimerId !== null) {
      window.clearTimeout(statusTimerId);
    }

    statusTimerId = window.setTimeout(() => {
      void reportStatus();
    }, 150);
  }

  async function ensureShareModalOpen(): Promise<HTMLElement> {
    let modal = document.querySelector<HTMLElement>(SELECTORS.shareModal);

    if (modal) {
      return modal;
    }

    const shareButton = document.querySelector<HTMLElement>(SELECTORS.shareButton);

    if (!shareButton) {
      throw new Error('Share button was not found on this Chess.com page.');
    }

    shareButton.click();
    modal = await waitForElement<HTMLElement>(SELECTORS.shareModal, 5000);

    if (!modal) {
      throw new Error('Share modal did not open.');
    }

    return modal;
  }

  async function ensurePgnTabOpen(): Promise<HTMLTextAreaElement> {
    const pgnTab = await waitForElement<HTMLElement>(SELECTORS.pgnTab, 5000);

    if (!pgnTab) {
      throw new Error('PGN tab was not found in the share modal.');
    }

    if (pgnTab.getAttribute('aria-selected') !== 'true') {
      pgnTab.click();
    }

    const pgnTextarea = await waitForElement<HTMLTextAreaElement>(SELECTORS.pgnTextarea, 5000);

    if (!pgnTextarea) {
      throw new Error('PGN text field was not found.');
    }

    return pgnTextarea;
  }

  async function extractPgn(): Promise<string> {
    await ensureShareModalOpen();
    const pgnTextarea = await ensurePgnTabOpen();
    const pgn = pgnTextarea.value.trim();

    if (!pgn) {
      throw new Error('PGN text was empty.');
    }

    return pgn;
  }

  async function closeShareModal(): Promise<void> {
    const modal = document.querySelector<HTMLElement>(SELECTORS.shareModal);

    if (!modal) {
      return;
    }

    for (const selector of SELECTORS.modalCloseButtons) {
      const closeButton = document.querySelector<HTMLElement>(selector);

      if (!closeButton) {
        continue;
      }

      closeButton.click();

      const modalStillOpen = await waitForElement<HTMLElement>(SELECTORS.shareModal, 400);

      if (!modalStillOpen) {
        return;
      }
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));

    await wait(100);
  }

  async function startImport(): Promise<void> {
    const pgn = await extractPgn();

    await closeShareModal();

    const response: unknown = await chrome.runtime.sendMessage({
      type: 'OPEN_LICHESS_IMPORT',
      pgn,
      sourceUrl: window.location.href
    } satisfies OpenLichessImportMessage);

    if (isOperationResponse(response) && response.ok) {
      return;
    }

    const errorMessage =
      isOperationResponse(response) && response.error
        ? response.error
        : 'Could not open the Lichess import page.';

    throw new Error(errorMessage);
  }

  async function handleMessage(
    message: unknown,
    sendResponse: (response: ChessComResponse) => void
  ): Promise<void> {
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

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
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