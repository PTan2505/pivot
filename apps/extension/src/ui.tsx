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
        "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/85",
        variant === "ghost" && "text-muted-foreground hover:bg-accent hover:text-foreground",
        variant === "outline" && "border border-border hover:bg-accent",
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
        "h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-[13px] placeholder:text-muted-foreground focus:border-primary focus:outline-none",
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
        "w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 text-[13px] leading-relaxed placeholder:text-muted-foreground focus:border-primary focus:outline-none",
        props.className,
      )}
    />
  );
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function Logo() {
  return (
    <span className="grid size-5 place-items-center rounded-[5px] bg-primary text-primary-foreground">
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect width="20" height="5" x="2" y="3" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
        <path d="M10 12h4" />
      </svg>
    </span>
  );
}
