import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
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

/** The PT monogram (ember P, ink T), the same paths as apps/web/src/components/brand.tsx. */
export function Logo() {
  return (
    <svg viewBox="0 0 232 170" fill="currentColor" className="h-5 w-auto shrink-0 text-ink" aria-hidden>
      <path
        d="M0 0H94A40 34 0 0 1 134 34H22A22 34 0 0 1 0 0ZM22 68H134A40 34 0 0 1 94 102H34V116A20 20 0 0 1 14 136H0V90A22 22 0 0 1 22 68Z"
        fill="var(--ember)"
      />
      <path d="M0 0H98V34H50V110A26 26 0 0 1 24 136H16V34H0Z" transform="translate(134 34)" />
    </svg>
  );
}
