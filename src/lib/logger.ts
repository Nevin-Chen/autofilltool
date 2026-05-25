/**
 * Tiny logger so we can keep a single prefix and an easy toggle later.
 * Intentionally minimal — no remote sinks, no telemetry.
 */

const PREFIX = '[autofilltool]';

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](PREFIX, ...args);
}

export const log = {
  debug: (...args: unknown[]) => emit('debug', ...args),
  info: (...args: unknown[]) => emit('info', ...args),
  warn: (...args: unknown[]) => emit('warn', ...args),
  error: (...args: unknown[]) => emit('error', ...args),
};
