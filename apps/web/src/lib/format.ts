export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString();
}

export function formatDuration(from: Date | null, to: Date | null): string {
  if (!from) return "—";
  const end = to ?? new Date();
  const seconds = Math.max(0, Math.floor((end.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Numeric compare for dotted versions, newest first when used as a sort. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const na = pa[i];
    const nb = pb[i];
    const va = Number.isFinite(na) ? (na as number) : -1;
    const vb = Number.isFinite(nb) ? (nb as number) : -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}
