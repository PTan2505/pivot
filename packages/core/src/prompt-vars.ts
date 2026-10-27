// `{{name}}` or `{{name|default value}}` placeholders inside prompts.
const VAR_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*(?:\|([^}]*))?\}\}/g;

export interface PromptVariable {
  name: string;
  defaultValue: string;
}

export function extractVariables(text: string): PromptVariable[] {
  const seen = new Map<string, PromptVariable>();
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1];
    if (!seen.has(name)) seen.set(name, { name, defaultValue: (m[2] ?? "").trim() });
  }
  return [...seen.values()];
}

export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (whole, name: string, def?: string) => {
    const v = values[name];
    if (v !== undefined && v !== "") return v;
    if (def !== undefined) return def.trim();
    return whole;
  });
}
