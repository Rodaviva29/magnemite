/**
 * The MITM version columns, derived from the device groups.
 *
 * Each group names the MITM its boxes run, and that is where the column comes
 * from — Magnemite installs these and writes their config, but nothing polls a
 * feed for them, so their version is reported rather than tracked.
 *
 * Two groups may name the same package: two sites on Aegis, pointed at two
 * Rotom instances by their own configs. That is one column, not two, or a fleet
 * with five sites grows five identical ones.
 */
export type MitmColumn = { packageName: string; label: string };

export type GroupMitm = {
  name: string;
  mitmPackageName: string | null;
  mitmLabel: string | null;
};

/** One column per distinct package, ordered by the group that first names it. */
export function mitmColumns(groups: GroupMitm[]): MitmColumn[] {
  const byPackage = new Map<string, string>();
  for (const group of [...groups].sort((a, b) => a.name.localeCompare(b.name))) {
    const packageName = group.mitmPackageName;
    if (!packageName || byPackage.has(packageName)) continue;
    byPackage.set(packageName, group.mitmLabel || (packageName.split(".").pop() ?? packageName));
  }
  return [...byPackage].map(([packageName, label]) => ({ packageName, label }));
}
