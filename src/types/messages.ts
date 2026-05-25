/**
 * All cross-context messages flow through a single discriminated union so the
 * compiler can keep the request/response shapes in sync between content
 * scripts, the popup, the options page, and the service worker.
 *
 * NOTE: Step 1 only wires the envelope and a small set of stub messages.
 * Future steps (AI suggestions, webhook logging, per-adapter fills) will add
 * variants here — keep them well-typed.
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
 * Records a "I submitted this application" click. The background appends to
 * chrome.storage history and, if a webhook is configured, POSTs to it. The
 * caller (overlay or popup) just submits the record; everything else is
 * handled in the worker.
 *
 * Only `source` and `status` are required. Everything else has a sane default
 * the worker fills in (id, timestamp) or is allowed to be empty (company,
 * role, jobUrl, note).
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

export type RequestMessage =
  | GetProfileMsg
  | GetSettingsMsg
  | PingMsg
  | FillPageMsg
  | LogSubmissionMsg
  | GetHistoryMsg
  | TestWebhookMsg;

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

/** Maps each request type to its response type. */
export interface MessageMap {
  GET_PROFILE: GetProfileResponse;
  GET_SETTINGS: GetSettingsResponse;
  PING: PingResponse;
  FILL_PAGE: FillPageResponse;
  LOG_SUBMISSION: LogSubmissionResponse;
  GET_HISTORY: GetHistoryResponse;
  TEST_WEBHOOK: TestWebhookResponse;
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
    t === 'TEST_WEBHOOK'
  );
}
