import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { sectionOf, TYPE_DEFS, type ResourceType } from "@pivot/core/types";
import { sectionHref } from "@/hooks/use-library-params";

export interface Crumb {
  label: ReactNode;
  /** Omitted for the current page, which is the last crumb. */
  href?: string;
}

/** Where this page sits: Section › Type › Item. The last crumb is the current page and is not a link. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[14px] text-ink-subtle">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <li aria-hidden className="flex">
                  <ChevronRight className="size-3.5 opacity-70" />
                </li>
              )}
              <li className="min-w-0">
                {c.href && !last ? (
                  <Link href={c.href} className="rounded-full transition-colors hover:text-ink">
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className="block truncate text-ink-secondary">
                    {c.label}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** Section › Type for a type; a one-type section (Sources, Skills) is a single crumb. */
export function typeCrumbs(type: ResourceType): Crumb[] {
  const section = sectionOf(type);
  if (section.types.length === 1) return [{ label: section.label, href: sectionHref(section) }];
  return [
    { label: section.label, href: sectionHref(section) },
    { label: TYPE_DEFS[type].plural, href: `/?type=${type}` },
  ];
}
