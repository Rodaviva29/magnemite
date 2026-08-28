"use client";

import { useCallback, useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

/** A row's value for one column, already reduced to something comparable. */
export type SortValue = string | number | boolean | null | undefined;

/**
 * Compares two cell values with the rules a table wants rather than the ones
 * JavaScript gives you: numbers numerically, strings case-insensitively, and
 * empty cells always at the bottom regardless of direction.
 */
export function compareValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let result: number;
  if (typeof a === "number" && typeof b === "number") result = a - b;
  else if (typeof a === "boolean" && typeof b === "boolean") result = Number(a) - Number(b);
  else result = String(a).localeCompare(String(b), undefined, { numeric: true });

  return direction === "asc" ? result : -result;
}

export type SortState<K extends string> = { key: K; direction: SortDirection };

/**
 * Sorting for a client table. `accessors` maps a column key to the value that
 * column sorts on, which keeps the comparison out of the JSX.
 */
export function useTableSort<K extends string, Row>(
  accessors: Record<K, (row: Row) => SortValue>,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  // First click on a new column sorts ascending; clicking the active one flips.
  const toggle = useCallback((key: K) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }, []);

  const sortRows = useCallback(
    (rows: Row[]) => {
      const accessor = accessors[sort.key];
      if (!accessor) return rows;
      return [...rows].sort((a, b) => compareValues(accessor(a), accessor(b), sort.direction));
    },
    // `accessors` is in here, not excluded as "shape only". The accessors close
    // over what the table is currently showing — the picked package on the
    // manual page, the MITM columns on the fleet table — so a map that changed
    // while `sort` did not left this closure sorting by the previous package
    // under a header naming the new one. Both callers build the map in a
    // useMemo, so this changes identity only when the columns really change.
    [accessors, sort],
  );

  const headProps = useCallback(
    (key: K) => ({
      active: sort.key === key,
      direction: sort.direction,
      onSort: () => toggle(key),
    }),
    [sort, toggle],
  );

  return useMemo(
    () => ({ sort, toggle, sortRows, headProps }),
    [sort, toggle, sortRows, headProps],
  );
}
