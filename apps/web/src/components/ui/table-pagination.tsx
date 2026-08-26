"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PAGE_SIZE_OPTIONS, type PageSize, type TablePagination } from "@/lib/table-pagination";

/**
 * The footer of a paged table: what you are looking at on the left, how much of
 * it to show and where to go on the right.
 *
 * It sits inside the table's card, under a rule, so the count reads as part of
 * the table rather than as a stray line of page text.
 */
export function TablePaginationBar<Row>({
  pagination,
  /** Plural noun for the rows, used in the count: "132 devices". */
  unit,
}: {
  pagination: TablePagination<Row>;
  unit: string;
}) {
  const { page, pageCount, pageSize, total, from, to, setPage, setPageSize } = pagination;
  const first = page <= 1;
  const last = page >= pageCount;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {total === 0 ? `No ${unit}` : `${from}–${to} of ${total} ${unit}`}
      </p>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">Rows</span>
          <Select
            aria-label="Rows per page"
            value={String(pageSize)}
            onValueChange={(value) =>
              setPageSize(value === "all" ? "all" : (Number(value) as PageSize))
            }
            className="h-8 w-[5.5rem]"
            options={[
              ...PAGE_SIZE_OPTIONS.map((size) => ({ value: String(size), label: String(size) })),
              { value: "all", label: "All" },
            ]}
          />
        </div>

        {pageCount > 1 ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={first}
              onClick={() => setPage(1)}
              aria-label="First page"
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={first}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <span className="px-1 text-xs tabular-nums text-muted-foreground">
              {page} / {pageCount}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={last}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={last}
              onClick={() => setPage(pageCount)}
              aria-label="Last page"
            >
              <ChevronsRight />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
