/**
 * Minimal levelled logger. Domains and device names must only ever be passed to
 * `debug`, so that nothing personal is logged at the default level.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = ORDER.info;

export function setLogLevel(level: LogLevel): void {
  threshold = ORDER[level];
}

function write(level: LogLevel, message: string): void {
  if (ORDER[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}\n`;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
}

export const log = {
  debug: (m: string) => write('debug', m),
  info: (m: string) => write('info', m),
  warn: (m: string) => write('warn', m),
  error: (m: string) => write('error', m),
};
