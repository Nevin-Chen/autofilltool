/**
 * All cross-context messages flow through one discriminated union so the
 * compiler keeps request/response shapes in sync across content scripts, the
 * popup, the options page, and the service worker.
 */

import type { Profile, Settings, SubmissionRecord } from '@/profile/schema';

/* ------------------------------------------------------------ Requests */

export type GetProfileMsg = { type: 'GET_PROFILE' };
export type GetSettingsMsg = { type: 'GET_SETTINGS' };
export type PingMsg = { type: 'PING' };

/** Asks the active tab's content script to run a fill pass. */
export type FillPageMsg = {
  type: 'FILL_PAGE';
  tabId: number;
  options?: { forceOverwrite?: boolean };
};

/**
 * Records a "submitted this application" click. The worker appends to history
 * and POSTs to the webhook if configured. Only `source`/`status` are required;
 * the worker fills id/timestamp and the rest may be empty.
 */
export type LogSubmissionMsg = {
  type: 'LOG_SUBMISSION';
  record: {
    source: SubmissionRecord['source'];
    status: SubmissionRecord['status'];
    id?: string;
    timestamp?: string;
    company?: string;
    role?: string;
    jobUrl?: string;
    note?: string;
  };
};

/** Reads the recent submission history for the popup. */
export type GetHistoryMsg = { type: 'GET_HISTORY'; limit?: number };

/** Fires a tiny test payload at the configured webhook for the Options page. */
export type TestWebhookMsg = { type: 'TEST_WEBHOOK' };

/**
 * Asks a content script (sent to the top frame) to show a transient in-page
 * notice — e.g. "No application form detected". Presentational only.
 */
export type ShowNoticeMsg = { type: 'SHOW_NOTICE'; text: string };

export type RequestMessage =
  | GetProfileMsg
  | GetSettingsMsg
  | PingMsg
  | FillPageMsg
  | LogSubmissionMsg
  | GetHistoryMsg
  | TestWebhookMsg
  | ShowNoticeMsg;

/* ------------------------------------------------------------ Responses */

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export type GetProfileResponse = Result<Profile>;
export type GetSettingsResponse = Result<Settings>;
export type PingResponse = Result<{ pong: true; at: string }>;
export type FillActionWire = {
  label: string;
  kind: string;
  status: 'filled' | 'skipped' | 'unsupported' | 'error';
  note?: string;
};
export type FillPageResponse = Result<{
  adapterId: string;
  filled: number;
  skipped: number;
  failed: number;
  total: number;
  /**
   * Candidate fields the adapter detected (summed across frames). DISTINCT from
   * `total` (filled+skipped+… actions, incl. resume). Zero => no form on the
   * page (US3 s3); >0 with filled=0 is a normal "all pre-filled" completion.
   */
  fieldsDetected: number;
  actions: FillActionWire[];
}>;
export type LogSubmissionResponse = Result<{
  stored: true;
  posted: boolean; // did we POST to the webhook?
  webhookError?: string; // if posted=false because the webhook failed
  record: SubmissionRecord;
}>;
export type GetHistoryResponse = Result<SubmissionRecord[]>;
export type TestWebhookResponse = Result<{ status: number }>;
export type ShowNoticeResponse = Result<{ shown: boolean }>;

/** Maps each request type to its response type. */
export interface MessageMap {
  GET_PROFILE: GetProfileResponse;
  GET_SETTINGS: GetSettingsResponse;
  PING: PingResponse;
  FILL_PAGE: FillPageResponse;
  LOG_SUBMISSION: LogSubmissionResponse;
  GET_HISTORY: GetHistoryResponse;
  TEST_WEBHOOK: TestWebhookResponse;
  SHOW_NOTICE: ShowNoticeResponse;
}

export type ResponseFor<M extends RequestMessage> = MessageMap[M['type']];

/* --------------------------------------------------------- Type guards */

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { type?: unknown }).type;
  return (
    t === 'GET_PROFILE' ||
    t === 'GET_SETTINGS' ||
    t === 'PING' ||
    t === 'FILL_PAGE' ||
    t === 'LOG_SUBMISSION' ||
    t === 'GET_HISTORY' ||
    t === 'TEST_WEBHOOK' ||
    t === 'SHOW_NOTICE'
  );
}
