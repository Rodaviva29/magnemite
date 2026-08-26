"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/** A page size, or every row at once. */
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number] | "all";

export type TablePagination<Row> = {
  /** The slice to render. */
  rows: Row[];
  page: number;
  pageCount: number;
  pageSize: PageSize;
  total: number;
  /** 1-based index of the first row on this page, 0 when there are none. */
  from: number;
  to: number;
  setPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
};

/**
 * Client-side paging for a table that already has all its rows.
 *
 * `resetKey` is what sends the reader back to page one: pass whatever the
 * filters add up to (query, dropdowns, sort). It deliberately is *not* the row
 * array — the dashboard refreshes itself every few seconds, and a new array
 * identity on each poll would yank the reader back to the first page while
 * they were reading the fourth.
 */
export function useTablePagination<Row>(
  rows: Row[],
  { pageSize: initialSize = 25, resetKey = "" }: { pageSize?: PageSize; resetKey?: string } = {},
): TablePagination<Row> {
  const [pageSize, setPageSizeState] = useState<PageSize>(initialSize);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const total = rows.length;
  const perPage = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  // Rows can disappear under the reader — a filter narrows, a device drops off
  // a poll — so the page in state is clamped rather than trusted.
  const current = Math.min(page, pageCount);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const visible = useMemo(
    () => rows.slice((current - 1) * perPage, current * perPage),
    [rows, current, perPage],
  );

  const setPageSize = useCallback((size: PageSize) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const clampPage = useCallback(
    (next: number) => setPage(Math.min(Math.max(1, next), pageCount)),
    [pageCount],
  );

  return {
    rows: visible,
    page: current,
    pageCount,
    pageSize,
    total,
    from: total === 0 ? 0 : (current - 1) * perPage + 1,
    to: Math.min(current * perPage, total),
    setPage: clampPage,
    setPageSize,
  };
}
