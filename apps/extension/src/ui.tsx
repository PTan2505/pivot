import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3.5",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "ghost" && "text-ink-secondary hover:bg-surface hover:text-ink",
        variant === "outline" && "bg-surface text-ink-secondary hover:bg-surface-raised hover:text-ink",
        className,
      )}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-9 w-full rounded-full border-0 bg-surface px-4 text-[13px] text-ink placeholder:text-ink-muted hover:bg-surface-raised focus:bg-surface-raised",
        props.className,
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        "w-full resize-none rounded-[14px] border-0 bg-surface px-4 py-2.5 text-[13px] leading-relaxed text-ink placeholder:text-ink-muted hover:bg-surface-raised focus:bg-surface-raised",
        props.className,
      )}
    />
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs text-ink-subtle">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Logo() {
  return (
    <span className="grid size-6 place-items-center rounded-full bg-ink text-canvas">
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect width="20" height="5" x="2" y="3" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
        <path d="M10 12h4" />
      </svg>
    </span>
  );
}
