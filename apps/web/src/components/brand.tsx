import { cn } from "@/lib/utils";

// PIVOT letterforms: 34-unit strokes on a 136-unit cap height. The P is two halves turned 180° on each other, with
// a counter as tall as a stroke, open to the left. Source SVGs and the brand board live in docs/brand/.
const P_HALVES =
  "M0 0H94A40 34 0 0 1 134 34H22A22 34 0 0 1 0 0ZM22 68H134A40 34 0 0 1 94 102H34V116A20 20 0 0 1 14 136H0V90A22 22 0 0 1 22 68Z";
/** Closes the P's bowl in the wordmark, where no T sits in the counter. */
const P_BRIDGE = "M96 33H134V69H96Z";
const T = "M0 0H98V34H50V110A26 26 0 0 1 24 136H16V34H0Z";
const I = "M0 0H34V110A26 26 0 0 1 8 136H0Z";
const V = "M0 0H36L64 94L92 0H128L84 136H44Z";
const O = "M68 0A68 68 0 1 1 68 136A68 68 0 1 1 68 0ZM68 34A34 34 0 1 0 68 102A34 34 0 1 0 68 34Z";

/** The PT monogram: the T's bar sits in the P's counter and closes its bowl. The P is ember, the T currentColor. */
export function PivotMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 232 170" fill="currentColor" aria-hidden className={cn("h-6 w-auto shrink-0", className)}>
      <path d={P_HALVES} fill="var(--ember)" />
      <path d={T} transform="translate(134 34)" />
    </svg>
  );
}

/** The PIVOT wordmark: an ember P, then IVOT in currentColor. The ember O is kept for the icon and splash, not the UI. */
export function PivotWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 586 136" fill="currentColor" aria-hidden className={cn("h-3.5 w-auto shrink-0", className)}>
      <path d={P_HALVES + P_BRIDGE} fill="var(--ember)" />
      <path d={I} transform="translate(154 0)" />
      <path d={V} transform="translate(206 0)" />
      <path d={O} transform="translate(342 0)" fillRule="evenodd" />
      <path d={T} transform="translate(488 0)" />
    </svg>
  );
}
