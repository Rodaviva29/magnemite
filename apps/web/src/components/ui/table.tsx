import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { SortDirection } from "@/lib/table-sort";
import { cn } from "@/lib/utils";

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /**
   * Classes for the scroll box around the table — this is where a height cap
   * goes (`max-h-[60vh]`), which turns on vertical scrolling with the header
   * pinned.
   */
  containerClassName?: string;
};

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, ...props }, ref) => (
    // Wide fleet tables scroll inside their own box rather than the page, and
    // with a height cap they scroll vertically here too.
    <div className={cn("relative w-full overflow-auto", containerClassName)}>
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  // Pinned so the columns stay readable while the body scrolls. Under
  // `border-collapse: collapse` a sticky header's own border is painted away
  // as it moves, so the rule under it is an inset shadow on the cells.
  <thead
    ref={ref}
    className={cn(
      "sticky top-0 z-20 bg-subtle [&_th]:shadow-[inset_0_-1px_0_var(--color-border)]",
      className,
    )}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  // The container already draws the bottom edge, so the last row's own border
  // would sit right on top of it as a double line.
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border transition-colors hover:bg-subtle data-[state=selected]:bg-subtle",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 px-3 text-left align-middle text-xs font-medium text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("px-3 py-2.5 align-middle", className)} {...props} />
));
TableCell.displayName = "TableCell";

/**
 * A header cell that sorts. The arrow is only inked on the active column; the
 * others show a faint hint on hover so the header does not turn into a row of
 * competing icons.
 */
function TableSortHead({
  children,
  active,
  direction,
  onSort,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const Icon = !active ? ChevronsUpDown : direction === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead
      className={cn("p-0", className)}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "group flex h-9 w-full items-center gap-1.5 px-3 transition-colors hover:text-foreground",
          align === "right" && "justify-end",
          align === "center" && "relative justify-center",
          active && "text-foreground",
        )}
      >
        {/* The arrow reserves its width even while invisible, so that the header
            does not jump when its column becomes the sorted one. That reservation
            is what pushed every aligned label off its own column, so it moves to
            wherever nothing is being aligned against: before the label on a
            right-aligned column, and out of the flow entirely on a centred one,
            where either side would be wrong. */}
        {align === "center" ? (
          <>
            {children}
            <Icon
              className={cn(
                "absolute right-3 h-3 w-3 shrink-0 transition-opacity",
                active ? "opacity-100" : "opacity-0 group-hover:opacity-60",
              )}
            />
          </>
        ) : align === "right" ? (
          <>
            <Icon
              className={cn(
                "h-3 w-3 shrink-0 transition-opacity",
                active ? "opacity-100" : "opacity-0 group-hover:opacity-60",
              )}
            />
            {children}
          </>
        ) : (
          <>
            {children}
            <Icon
              className={cn(
                "h-3 w-3 shrink-0 transition-opacity",
                active ? "opacity-100" : "opacity-0 group-hover:opacity-60",
              )}
            />
          </>
        )}
      </button>
    </TableHead>
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableSortHead, TableCell };
