/**
 * Colouring for a live log line.
 *
 * Two shapes to deal with. `logcat -v time` is regular enough to take apart —
 * timestamp, level, tag, message — and each part earns its own weight. A log
 * an app writes itself is anyone's guess, so the level is whatever word it
 * used, and everything else stays as it was written.
 *
 * The point is scanning: errors should catch the eye at a glance, and the
 * timestamps that start every line should not.
 */

export type LogLevel = "error" | "warn" | "info" | "debug" | "verbose" | "plain";

/** `01-02 15:04:05.000 E/SomeTag( 1234): message` */
const LOGCAT = /^(\d{2}-\d{2} [\d:.]+)\s+([VDIWEFS])\/([^(]*)\(\s*(\d+)\):\s?(.*)$/;

/** Whatever a hand-rolled logger felt like writing. */
const LEVEL_WORD = /\b(FATAL|ERROR|ERR|SEVERE|EXCEPTION|WARN(?:ING)?|INFO|DEBUG|TRACE|VERBOSE)\b/i;

const LOGCAT_LEVELS: Record<string, LogLevel> = {
  F: "error",
  E: "error",
  W: "warn",
  I: "info",
  D: "debug",
  V: "verbose",
  S: "verbose",
};

const TEXT: Record<LogLevel, string> = {
  error: "text-destructive",
  warn: "text-warning",
  info: "text-foreground",
  debug: "text-muted-foreground",
  verbose: "text-muted-foreground",
  plain: "text-foreground",
};

export type ParsedLine = {
  level: LogLevel;
  timestamp: string | null;
  tag: string | null;
  pid: string | null;
  message: string;
};

function levelFromWord(line: string): LogLevel {
  const match = LEVEL_WORD.exec(line);
  if (!match) return "plain";
  const word = match[1]!.toUpperCase();
  if (["FATAL", "ERROR", "ERR", "SEVERE", "EXCEPTION"].includes(word)) return "error";
  if (word.startsWith("WARN")) return "warn";
  if (word === "INFO") return "info";
  return "debug";
}

export function parseLine(line: string): ParsedLine {
  const logcat = LOGCAT.exec(line);
  if (logcat) {
    const [, timestamp, level, tag, pid, message] = logcat;
    return {
      level: LOGCAT_LEVELS[level!] ?? "plain",
      timestamp: timestamp!,
      tag: tag!.trim(),
      pid: pid!,
      message: message ?? "",
    };
  }

  return { level: levelFromWord(line), timestamp: null, tag: null, pid: null, message: line };
}

export function levelClass(level: LogLevel): string {
  return TEXT[level];
}
