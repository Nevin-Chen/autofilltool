/**
 * All cross-context messages flow through a single discriminated union so the
 * compiler can keep the request/response shapes in sync between content
 * scripts, the popup, the options page, and the service worker.
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

/** Logs a manual "I submitted this" click. Step 6 wires this. */
export type LogSubmissionMsg = {
  type: 'LOG_SUBMISSION';
  record: SubmissionRecord;
};

export type RequestMessage =
  | GetProfileMsg
  | GetSettingsMsg
  | PingMsg
  | FillPageMsg
  | LogSubmissionMsg;

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
export type LogSubmissionResponse = Result<{ stored: true }>;

/** Maps each request type to its response type. */
export interface MessageMap {
  GET_PROFILE: GetProfileResponse;
  GET_SETTINGS: GetSettingsResponse;
  PING: PingResponse;
  FILL_PAGE: FillPageResponse;
  LOG_SUBMISSION: LogSubmissionResponse;
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
    t === 'LOG_SUBMISSION'
  );
}
