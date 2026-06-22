import type { Profile, Settings, SubmissionRecord } from '@/profile/schema';

export type GetProfileMsg = { type: 'GET_PROFILE' };
export type GetSettingsMsg = { type: 'GET_SETTINGS' };
export type PingMsg = { type: 'PING' };
export type FillPageMsg = {
  type: 'FILL_PAGE';
  tabId: number;
  options?: { forceOverwrite?: boolean };
};

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

export type GetHistoryMsg = { type: 'GET_HISTORY'; limit?: number };
export type ClearHistoryMsg = { type: 'CLEAR_HISTORY' };
export type TestWebhookMsg = { type: 'TEST_WEBHOOK' };

export type ShowNoticeMsg = { type: 'SHOW_NOTICE'; text: string };

export type AiClassifyMsg = {
  type: 'AI_CLASSIFY';
  request: {
    question: string;
    description?: string;
    fieldType: 'text' | 'textarea' | 'radio' | 'select' | 'combobox';
    options?: string[];
    jobDescription?: string;
    job?: { company?: string; role?: string; jobUrl?: string };
    wasClassified?: boolean;
  };
};

export type RequestMessage =
  | GetProfileMsg
  | GetSettingsMsg
  | PingMsg
  | FillPageMsg
  | LogSubmissionMsg
  | GetHistoryMsg
  | ClearHistoryMsg
  | TestWebhookMsg
  | ShowNoticeMsg
  | AiClassifyMsg;

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
  fieldsDetected: number;
  actions: FillActionWire[];
}>;
export type LogSubmissionResponse = Result<{
  stored: true;
  posted: boolean;
  webhookError?: string;
  record: SubmissionRecord;
}>;
export type GetHistoryResponse = Result<SubmissionRecord[]>;
export type ClearHistoryResponse = Result<{ cleared: true }>;
export type TestWebhookResponse = Result<{ status: number }>;
export type ShowNoticeResponse = Result<{ shown: boolean }>;
export type AiClassifyResponse = Result<{ value: string | null }>;

export interface MessageMap {
  GET_PROFILE: GetProfileResponse;
  GET_SETTINGS: GetSettingsResponse;
  PING: PingResponse;
  FILL_PAGE: FillPageResponse;
  LOG_SUBMISSION: LogSubmissionResponse;
  GET_HISTORY: GetHistoryResponse;
  CLEAR_HISTORY: ClearHistoryResponse;
  TEST_WEBHOOK: TestWebhookResponse;
  SHOW_NOTICE: ShowNoticeResponse;
  AI_CLASSIFY: AiClassifyResponse;
}

export type ResponseFor<M extends RequestMessage> = MessageMap[M['type']];

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
    t === 'CLEAR_HISTORY' ||
    t === 'TEST_WEBHOOK' ||
    t === 'SHOW_NOTICE' ||
    t === 'AI_CLASSIFY'
  );
}
