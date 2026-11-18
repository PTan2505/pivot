// Command options. An unknown or malformed option stops everything before any side effect: a typo must never start
// PIVOT on a data folder or port you didn't mean.
const ALLOWED = {
  start: ["port", "data-dir", "no-open"],
  doctor: ["port", "data-dir"],
  passphrase: ["data-dir", "replace", "stdin"],
  extension: ["data-dir"],
};
const VALUED = new Set(["port", "data-dir"]);

export function parseArgs(args, command) {
  const allowed = ALLOWED[command];
  if (!allowed) throw new Error(`Unknown command ${JSON.stringify(command)}. Run pivot-studio help.`);
  const opts = { open: true };
  for (let i = 0; i < args.length; i++) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!m || !allowed.includes(m[1]))
      throw new Error(`Unknown option ${JSON.stringify(args[i])} for ${command}. Nothing was done.`);
    const key = m[1];
    if (VALUED.has(key)) {
      const value = m[2] ?? args[++i];
      if (value === undefined || value === "" || value.startsWith("--"))
        throw new Error(`--${key} needs a value. Nothing was done.`);
      if (key === "port" && !/^\d{2,5}$/.test(value)) throw new Error(`Bad port ${JSON.stringify(value)}.`);
      opts[key === "data-dir" ? "dataDir" : key] = value;
    } else if (m[2] !== undefined) {
      throw new Error(`--${key} takes no value. Nothing was done.`);
    } else if (key === "no-open") opts.open = false;
    else opts[key] = true;
  }
  return opts;
}
