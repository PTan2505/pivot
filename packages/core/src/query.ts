// How a search box query becomes match patterns. Pure, so the library list and the MCP search read queries the same way.

/** Words that say nothing about what you're looking for. */
const STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/**
 * Words that describe nearly everything saved here ("pricing page", "mobile app screens"). They don't have to match,
 * unless the query has nothing else.
 */
const SOFT_WORDS = new Set([
  "page",
  "pages",
  "site",
  "sites",
  "website",
  "websites",
  "screen",
  "screens",
  "example",
  "examples",
  "galleries",
  "product",
  "ui",
  "ux",
  "design",
  "designs",
]);

/** Names people use for the same thing, matched as one term. Kept close to the facet vocabulary. */
const SYNONYMS: string[][] = [
  ["login", "log in", "sign in", "signin", "auth", "authentication"],
  ["signup", "sign up", "register", "registration"],
  ["docs", "documentation"],
  ["pricing", "plans", "price"],
  ["palette", "colors", "colours"],
  ["ecommerce", "e-commerce", "shop", "store"],
  ["animation", "animations", "motion", "animated"],
  ["mobile", "ios", "android"],
  ["inspiration", "gallery", "showcase"],
];

export interface QueryTerm {
  /** What the person typed for this term. */
  text: string;
  /** PostgreSQL regular expressions; a field matches the term when it matches any of them. */
  patterns: string[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A plural is found by its singular, and the match is a prefix, so "icons" finds "icon" and "icons". */
function stem(word: string) {
  return word.length > 3 && /[^su]s$/.test(word) ? word.slice(0, -1) : word;
}

/** Starts at a word boundary, so "sign" no longer matches inside "design"; words of a phrase may be joined by - or _. */
function wordStart(phrase: string) {
  return `\\m${phrase.split(/\s+/).map(escapeRegex).join("[\\s_-]*")}`;
}

/** A term's PostgreSQL pattern as a JavaScript regex, for matching in memory (external catalogs). */
export function toJsRegex(pattern: string) {
  return new RegExp(pattern.replace(/\\m/g, "(?<![\\p{L}\\p{N}])"), "iu");
}

/**
 * Splits a query into terms that must all match (AND), each a set of patterns that may match anywhere (OR):
 * synonyms are one term, stop words are dropped, and soft words only count when nothing else is left.
 */
export function parseQuery(query: string): QueryTerm[] {
  let rest = ` ${query.toLowerCase().trim()} `;
  const terms: QueryTerm[] = [];

  for (const group of SYNONYMS) {
    const found = [...group]
      .sort((a, b) => b.length - a.length)
      .find((phrase) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, "u").test(rest));
    if (!found) continue;
    // the group is one term: "inspiration gallery" asks for it once, not for "inspiration" and then "gallery"
    for (const phrase of group)
      rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, "gu"), " ");
    terms.push({ text: found, patterns: group.map(wordStart) });
  }

  const words = rest
    .split(/\s+/)
    // trim punctuation around a word, but keep + and # so "c++" and "c#" stay themselves
    .map((w) => w.replace(/^[^\p{L}\p{N}+#]+|[^\p{L}\p{N}+#]+$/gu, ""))
    .filter(Boolean);
  const meaningful = words.filter((w) => !STOP_WORDS.has(w));
  const required = meaningful.filter((w) => !SOFT_WORDS.has(w));
  const kept = terms.length || required.length ? required : meaningful.length ? meaningful : words;
  for (const word of kept.slice(0, 8)) terms.push({ text: word, patterns: [wordStart(stem(word))] });
  return terms;
}
