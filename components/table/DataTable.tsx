"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { MetricFormat } from "@/lib/metrics/definitions";
import { formatMetric } from "@/lib/format/metric";
import { formatDate } from "@/lib/format/ist";
import { cn } from "@/lib/cn";

/** Serializable column spec, so server components can define tables without passing functions. */
export interface TableColumn {
  key: string;
  label: string;
  format?: MetricFormat | "text" | "date";
  align?: "left" | "right";
  hint?: string;
}

export type TableRow = Record<string, string | number | null>;

interface DataTableProps {
  columns: TableColumn[];
  rows: TableRow[];
  /** Filename stem for CSV export. Rows are already aggregate and PII-free. */
  exportName?: string;
  pageSize?: number;
  emptyMessage?: string;
  searchable?: boolean;
}

function display(v: string | number | null, format: TableColumn["format"]): string {
  if (v === null || v === undefined || v === "") return "—";
  if (format === "date") return formatDate(String(v));
  if (format === "text" || format === undefined) return String(v);
  return formatMetric(typeof v === "number" ? v : Number(v), format);
}

function toCsv(columns: TableColumn[], rows: TableRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]))).join(","));
  return [head, ...body].join("\n");
}

export function DataTable({ columns, rows, exportName, pageSize = 15, emptyMessage = "No rows.", searchable = true }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");

  const defs = useMemo<ColumnDef<TableRow>[]>(
    () =>
      columns.map((c) => ({
        id: c.key,
        accessorFn: (r) => r[c.key],
        header: c.label,
        cell: (info) => display(info.getValue() as string | number | null, c.format),
        sortingFn: c.format && c.format !== "text" && c.format !== "date" ? "basic" : "alphanumeric",
        meta: c,
      })),
    [columns],
  );

  // TanStack Table returns non-memoizable functions; React Compiler skips this component by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const exportCsv = () => {
    const visible = table.getFilteredRowModel().rows.map((r) => r.original);
    const blob = new Blob([toCsv(columns, visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pageCount = table.getPageCount();

  return (
    <div className="space-y-2">
      {(searchable || exportName) && rows.length > 0 ? (
        <div className="flex items-center justify-between gap-2">
          {searchable ? (
            <label className="relative block w-full max-w-xs">
              <span className="sr-only">Filter rows</span>
              <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter…"
                className="w-full rounded-md border border-line bg-surface-1 py-1.5 pl-7 pr-2 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            </label>
          ) : (
            <span />
          )}
          {exportName ? (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <Download size={13} aria-hidden /> CSV
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-surface-2/60">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const col = h.column.columnDef.meta as TableColumn;
                  const right = col.align === "right" || (col.format && col.format !== "text" && col.format !== "date");
                  const sorted = h.column.getIsSorted();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                      className={cn("whitespace-nowrap border-b border-line px-3 py-2 font-medium text-ink-2", right ? "text-right" : "text-left")}
                      title={col.hint}
                    >
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn("inline-flex items-center gap-1 hover:text-ink", right && "flex-row-reverse")}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? <ArrowUp size={11} /> : sorted === "desc" ? <ArrowDown size={11} /> : <ArrowUpDown size={11} className="opacity-40" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-ink-3">
                  {rows.length === 0 ? emptyMessage : "No rows match the filter."}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                  {r.getVisibleCells().map((c) => {
                    const col = c.column.columnDef.meta as TableColumn;
                    const right = col.align === "right" || (col.format && col.format !== "text" && col.format !== "date");
                    return (
                      <td
                        key={c.id}
                        // Text columns wrap (names, reasons) so tables fit their card; numbers never wrap.
                        className={cn("px-3 py-1.5 align-top text-ink", right ? "tabular whitespace-nowrap text-right" : col.format === "date" ? "whitespace-nowrap text-left" : "min-w-[6rem] max-w-[20rem] break-words text-left")}
                      >
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs text-ink-2">
          <span className="tabular">
            Page {table.getState().pagination.pageIndex + 1} of {pageCount}
          </span>
          <button type="button" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} className="rounded border border-line p-1 disabled:opacity-40">
            <ChevronLeft size={13} />
          </button>
          <button type="button" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} className="rounded border border-line p-1 disabled:opacity-40">
            <ChevronRight size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
