# pivot-ui

PIVOT is your own library of UI references (screenshots of real sites, tagged by page type, domain, style and pattern) and the place where design sessions with Claude Code live. It runs on your machine, and your references stay there.

```bash
npx pivot-ui
```

That serves PIVOT on http://127.0.0.1:4321 and opens it. The first start downloads Chromium for screenshots (about 150 MB). Node.js 22 or newer is required.

Then connect Claude Code with the plugin:

```bash
claude plugin install pivot --marketplace PTan2505/pivot
```

## Commands

| Command                       | What it does                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `pivot-ui` / `pivot-ui start` | Serve PIVOT (`--port`, `--data-dir`, `--no-open`)                                      |
| `pivot-ui doctor`             | Check Node, Chromium, the data folder, the token, the passphrase, PIVOT and the plugin |
| `pivot-ui passphrase`         | Set the owner passphrase that approving a design needs (`--replace` to change it)      |
| `pivot-ui extension`          | Put the Chrome extension in `<data folder>/extension` and print how to load it         |
| `pivot-ui preview <session>`  | Open a design session's mockups in a separate, network-locked browser window           |
| `pivot-ui motion-qa <plan>`   | Check a build's motion against an approved plan                                        |

## Your data

Everything lives in `~/.pivot` (or `--data-dir`, or `PIVOT_DATA_DIR`): the local database, screenshots, the API token the extension and the Claude Code tools use, and the owner passphrase's hash. To keep the library in Postgres (Neon) or the files in Cloudflare R2, put `DATABASE_URL` or the `R2_*` keys in `~/.pivot/.env`.

PIVOT only listens on `127.0.0.1`. Writes need the app's own page or the API token.

## How the package is built

From a checkout of [PTan2505/pivot](https://github.com/PTan2505/pivot): `pnpm cli:build` builds the web app as a Next.js standalone server and the extension, then assembles `apps/cli/dist`. The native packages (sharp, Playwright, PGlite, postgres, the S3 client) are not bundled: they are this package's dependencies, pinned to the versions the app was built with, so npm installs the right ones for your machine.

To try a build before publishing, without touching your real data or port:

```bash
pnpm cli:build && cd apps/cli && npm pack
HOME=$(mktemp -d) npx ./pivot-ui-*.tgz start --data-dir /tmp/pivot-try --port 4410
```

License: MIT.
