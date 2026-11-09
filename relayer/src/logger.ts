import pino, { type DestinationStream } from "pino";
import type { Log } from "./pipeline.js";

const REDACT = ["apiKey", "nearAiApiKey", "nearRelayerKey", "secretKey", "authorization", "Authorization", "*.apiKey", "*.nearAiApiKey", "*.nearRelayerKey", "*.secretKey", "headers.Authorization"];
const URL_WITH_PATH = /(https?:\/\/[^\s/"'?#]+)[^\s"']*/g;
const MIN_SECRET_LENGTH = 6;

/**
 * viem and near-api-js put the full RPC URL (provider keys live in its path or query)
 * and request bodies into error messages, and pino redaction only matches key names.
 * Every string value is scrubbed so a transient RPC error cannot write a key to the log.
 */
export function createScrubber(secrets: readonly string[]): (text: string) => string {
  const known = secrets.filter((s) => s.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length);
  return (text) => known.reduce((acc, secret) => acc.split(secret).join("[redacted]"), text).replace(URL_WITH_PATH, "$1/[redacted]");
}

function scrubValue(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === "string") return scrub(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, scrub));
  if (value instanceof Error) return scrub(`${value.name}: ${value.message}`);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v, scrub)]));
  }
  return value;
}

export function createLogger(level: string, destination?: DestinationStream, secrets: readonly string[] = [], service = "psephex-relayer"): Log {
  const options = {
    level,
    base: { service },
    redact: { paths: REDACT, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  const logger = destination ? pino(options, destination) : pino(options);
  const scrub = createScrubber(secrets);
  const clean = (obj: object): object => scrubValue(obj, scrub) as object;
  return {
    info: (obj, msg) => logger.info(clean(obj), scrub(msg)),
    warn: (obj, msg) => logger.warn(clean(obj), scrub(msg)),
    error: (obj, msg) => logger.error(clean(obj), scrub(msg)),
  };
}
