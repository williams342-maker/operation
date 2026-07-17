import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function Card({ children }: PropsWithChildren) {
  return <section className="rounded-lg border border-border bg-panel p-4">{children}</section>;
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`rounded-md bg-primary px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50 ${props.className || ""}`} />;
}

export function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />;
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "success" | "danger" | "warning" }>) {
  const color = tone === "success" ? "text-success border-success/40" : tone === "danger" ? "text-danger border-danger/40" : tone === "warning" ? "text-warning border-warning/40" : "text-muted border-border";
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${color}`}>{children}</span>;
}
