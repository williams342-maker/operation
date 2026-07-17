import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { cn } from "../lib/utils";

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <section className={cn("rounded-lg border border-border bg-panel p-4 shadow-sm", className)}>{children}</section>;
}

export function Button({ className, variant = "default", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "danger" | "ghost" | "secondary" }) {
  const variants = {
    default: "bg-primary text-slate-950 hover:bg-primary/90",
    danger: "bg-danger text-white hover:bg-danger/90",
    ghost: "bg-transparent text-foreground hover:bg-muted",
    secondary: "bg-muted text-foreground hover:bg-muted/80"
  };
  return <button className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50", variants[variant], className)} {...props} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("min-h-40 w-full rounded-md border border-border bg-background p-3 font-mono text-sm outline-none focus:border-primary", props.className)} />;
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" | "danger" }>) {
  const tones = {
    neutral: "border-border bg-muted text-subdued",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
    danger: "border-danger/30 bg-danger/10 text-danger"
  };
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Progress({ value }: { value: number }) {
  return <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function ConfirmButton({ message, onConfirm, children, variant = "secondary" }: PropsWithChildren<{ message: string; onConfirm: () => void; variant?: "default" | "danger" | "ghost" | "secondary" }>) {
  return <Button variant={variant} onClick={() => { if (window.confirm(message)) onConfirm(); }}>{children}</Button>;
}
