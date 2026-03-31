interface PendingImport {
  pgn: string;
  sourceUrl: string;
  createdAt: number;
}

interface GetStatusRequest {
  type: 'GET_STATUS';
}

interface StartImportRequest {
  type: 'START_IMPORT';
}

type ChessTabRequest = GetStatusRequest | StartImportRequest;

interface PageStatusMessage {
  type: 'PAGE_STATUS';
  ready: boolean;
}

interface OpenLichessImportMessage {
  type: 'OPEN_LICHESS_IMPORT';
  pgn: string;
  sourceUrl: string;
}

interface GetPendingImportMessage {
  type: 'GET_PENDING_IMPORT';
  importId: string;
}

interface ClearPendingImportMessage {
  type: 'CLEAR_PENDING_IMPORT';
  importId: string;
}

type WorkerMessage =
  | PageStatusMessage
  | OpenLichessImportMessage
  | GetPendingImportMessage
  | ClearPendingImportMessage;

interface GetStatusResponse {
  ready: boolean;
}

interface OperationResponse {
  ok: boolean;
  error?: string;
}

type GetPendingImportResponse =
  | {
      ok: true;
      pendingImport: PendingImport | null;
    }
  | {
      ok: false;
      error?: string;
    };