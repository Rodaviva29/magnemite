import type { VersionSource } from "@magnemite/db";

export type DiscoveredVersion = {
  source: VersionSource;
  /** Which feed listed it. Null only for manual uploads. */
  feedId: string | null;
  version: string;
  buildCode: string | null;
  arch: string;
  filename: string;
  remoteUrl: string;
  sizeBytes: number;
  /** Only some feeds publish one. */
  md5: string | null;
  publishedAt: Date | null;
};

/**
 * Compare dotted versions like "0.425.1" numerically. Returns > 0 when `a`
 * is newer. Anything unparseable sorts last so it never wins a "latest" pick.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(".").map((p) => Number.parseInt(p, 10));
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = pa[i];
    const nb = pb[i];
    const va = Number.isFinite(na) ? (na as number) : -1;
    const vb = Number.isFinite(nb) ? (nb as number) : -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}
