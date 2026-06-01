/**
 * Encrypted profile export/import. The extension is local-first (nothing syncs),
 * but users still want backups/machine moves. The blob can hold an AI API key
 * and résumé bytes, so we encrypt the whole bundle with a passphrase before it
 * leaves the browser.
 *
 * Crypto (WebCrypto, works in MV3 workers, Options, and Node 20 tests):
 * PBKDF2-SHA256 150k iters + 16-byte salt → AES-GCM 256, 12-byte IV. Salt/IV
 * ride in the envelope in the clear (not secrets). Envelope is JSON:
 * `{ v, alg, kdf, iter, salt, iv, ciphertext }` (last three base64); `v` is the
 * envelope version, independent of the payload's schemaVersion.
 */

import {
  ProfileSchema,
  SettingsSchema,
  ResumeRecordSchema,
  SubmissionRecordSchema,
  CURRENT_SCHEMA_VERSION,
  type Profile,
  type Settings,
  type ResumeRecord,
  type SubmissionRecord,
} from './schema';
import { z } from 'zod';
import { bytesToBase64, base64ToBytes } from './resume';

/** Bump if the envelope shape or crypto parameters change incompatibly. */
export const EXPORT_ENVELOPE_VERSION = 1 as const;

const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

/* ------------------------------------------------------------ payload shape */

/**
 * Decrypted contents. `schemaVersion` mirrors storage so old exports can reuse
 * migration hooks; résumé/history optional so a minimal export still validates.
 */
export const ExportPayloadSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  profile: ProfileSchema,
  settings: SettingsSchema,
  resume: ResumeRecordSchema.nullable().default(null),
  history: z.array(SubmissionRecordSchema).default([]),
});
export type ExportPayload = z.infer<typeof ExportPayloadSchema>;

/** The on-disk encrypted envelope. Everything except v/iter is base64. */
export const ExportEnvelopeSchema = z.object({
  v: z.literal(EXPORT_ENVELOPE_VERSION),
  alg: z.literal('AES-GCM'),
  kdf: z.literal('PBKDF2-SHA256'),
  iter: z.number().int().positive(),
  salt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});
export type ExportEnvelope = z.infer<typeof ExportEnvelopeSchema>;

/* --------------------------------------------------------------- key derivation */

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      // Copy into a fresh ArrayBuffer so the BufferSource type narrows cleanly.
      salt: salt.slice().buffer,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* --------------------------------------------------------------- public API */

/** Encrypt a bundle with a passphrase (caller wipes it afterwards; we don't retain it). */
export async function encryptPayload(
  payload: ExportPayload,
  passphrase: string,
): Promise<ExportEnvelope> {
  if (!passphrase) throw new Error('Passphrase is required.');
  const parsed = ExportPayloadSchema.parse(payload);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const plaintext = new TextEncoder().encode(JSON.stringify(parsed));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.slice().buffer },
    key,
    plaintext,
  );

  return {
    v: EXPORT_ENVELOPE_VERSION,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
  };
}

/**
 * Decrypt an envelope into a validated payload. Wrong passphrase or tampered
 * ciphertext fails AES-GCM's auth tag (OperationError) → friendly error.
 */
export async function decryptPayload(
  envelope: unknown,
  passphrase: string,
): Promise<ExportPayload> {
  if (!passphrase) throw new Error('Passphrase is required.');
  const env = ExportEnvelopeSchema.parse(envelope);

  const salt = base64ToBytes(env.salt);
  const iv = base64ToBytes(env.iv);
  const key = await deriveKey(passphrase, salt, env.iter);

  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.slice().buffer },
      key,
      base64ToBytes(env.ciphertext).slice().buffer,
    );
  } catch {
    throw new Error('Decryption failed — wrong passphrase or corrupted file.');
  }

  const text = new TextDecoder().decode(plainBuf);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Decrypted data is not valid JSON.');
  }
  return ExportPayloadSchema.parse(json);
}

/* --------------------------------------------------------------- convenience */

/** Assemble an ExportPayload, stamping the current schemaVersion for callers. */
export function buildPayload(args: {
  profile: Profile;
  settings: Settings;
  resume?: ResumeRecord | null;
  history?: SubmissionRecord[];
}): ExportPayload {
  return ExportPayloadSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: args.profile,
    settings: args.settings,
    resume: args.resume ?? null,
    history: args.history ?? [],
  });
}

/** Filename suggested for downloads — dated so backups don't clobber. */
export function suggestedExportFilename(now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  return `autofilltool-backup-${stamp}.json`;
}
