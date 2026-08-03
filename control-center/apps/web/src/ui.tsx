import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { isValidElement } from "react";
export function Card({ children }: PropsWithChildren) { return <section className="rounded-lg border border-border bg-panel p-4 shadow-sm">{children}</section>; }
// Shared focus ring for keyboard users (WCAG 2.4.7 visible focus). focus-visible only, so pointer
// interactions stay clean. Reused across interactive primitives for a consistent, obvious focus state.
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-primary/90 disabled:opacity-50 ${focusRing} ${props.className || ""}`} />; }
export function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} className={`inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text transition-colors hover:bg-background disabled:opacity-50 ${focusRing} ${props.className || ""}`} />; }
export function Field(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary ${focusRing} ${props.className || ""}`} />; }
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary ${focusRing} ${props.className || ""}`} />; }
export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "success" | "danger" | "warning" }>) { const color = tone === "success" ? "text-success border-success/40" : tone === "danger" ? "text-danger border-danger/40" : tone === "warning" ? "text-warning border-warning/40" : "text-muted border-border"; return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${color}`}>{children}</span>; }
// Status shown with BOTH a colored dot and a text label — never color alone (WCAG 1.4.1). aria-hidden
// on the dot; the label is the accessible/visible source of truth.
export function StatusDot({ tone = "neutral", label }: { tone?: "neutral" | "success" | "danger" | "warning"; label: string }) { const dot = tone === "success" ? "bg-success" : tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-muted"; return <span className="inline-flex items-center gap-1.5 text-sm"><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />{label}</span>; }
export function Empty({ title }: { title: string }) { return <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">{title}</div>; }
export function Skeleton() { return <div className="h-24 animate-pulse rounded-md bg-border/40 motion-reduce:animate-none" role="status" aria-label="Loading" />; }
export function Toolbar({ children }: PropsWithChildren) { return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>; }
export function Table({ columns, rows, empty = "No records" }: { columns: string[]; rows?: ReactNode[][]; empty?: string }) {
  if (!rows?.length) return <Empty title={empty} />;
  if (columns.join("|") === "Display name|Website|Hostname|Agent|Enrollment|Last seen|Actions") {
    return <div className="grid gap-4">{rows.map((row, index) => {
      const pending = isValidElement<{ children?: ReactNode }>(row[4]) && row[4].props.children === "pending";
      return <article key={index} className="rounded-lg border border-border bg-background/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-base font-semibold text-success">● {row[0]}</h3><div className="mt-1 text-sm">{row[1]}</div></div>
          <div className="flex flex-wrap gap-2">{row[6]}</div>
        </div>
        {pending ? <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted">Website</dt><dd className="mt-1">{row[1]}</dd></div>
          <div><dt className="text-muted">Agent</dt><dd className="mt-1">Waiting for installation</dd></div>
          <div><dt className="text-muted">Heartbeat</dt><dd className="mt-1">Never</dd></div>
          <div><dt className="text-muted">Last Check</dt><dd className="mt-1">{row[5]}</dd></div>
        </dl> : <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div><dt className="text-muted">Hostname</dt><dd className="mt-1">{row[2]}</dd></div>
          <div><dt className="text-muted">Website</dt><dd className="mt-1">{row[1]}</dd></div>
          <div><dt className="text-muted">CPU</dt><dd className="mt-1">--</dd></div>
          <div><dt className="text-muted">Memory</dt><dd className="mt-1">--</dd></div>
          <div><dt className="text-muted">Last Seen</dt><dd className="mt-1">{row[5]}</dd></div>
        </dl>}
      </article>;
    })}</div>;
  }
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-muted"><tr>{columns.map((column) => <th key={column} className="border-b border-border px-2 py-2 font-medium">{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border/60">{row.map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-2 align-top">{cell}</td>)}</tr>)}</tbody></table></div>;
}
