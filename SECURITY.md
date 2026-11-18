# Security

## Reporting a vulnerability

Please report it privately, not in a public issue: on GitHub, open the repository's **Security** tab and choose **Report a vulnerability**. Include what an attacker can do, the steps to reproduce it, and the version or commit you tested.

You'll get an answer as soon as the maintainer can look at it. PIVOT is maintained by one person, so there is no fixed response time. Fixes go into the latest version only.

## What PIVOT protects

PIVOT runs on your own machine for one user. It is built to keep other websites, other programs and AI agents from acting as you:

- **Network:**
  - The server listens on `127.0.0.1` only.
  - Requests whose `Host` isn't localhost are refused, which blocks DNS rebinding.
- **Writes:**
  - A write must come from PIVOT's own pages (same origin) or carry the API token in `<data folder>/api-token`. This blocks cross-site requests and other local scripts.
  - The extension and the Claude Code tools use that token.
- **Approvals:**
  - Approving a design, or restoring a backup, needs the owner passphrase on top of the token. Only a scrypt hash of it is stored.
  - It is set from a terminal (`pivot-ui passphrase`), never over the API, so an agent holding the token can't approve.
- **Fetching pages:** URL fetches and screenshots refuse private and local network addresses.
- **Untrusted content:**
  - Uploaded files are served with a sandboxing Content Security Policy.
  - Mockups run in sandboxed frames.
  - The interactive preview opens them in a separate, network-locked browser window.
- **Agent input:** text saved in the library is treated as data, not instructions, by the design skills and the MCP tools.

## Out of scope

- Anyone who can already run code as your user or read your data folder (`~/.pivot`). They can read the token and the passphrase hash, and try guesses offline. Use a passphrase you don't use elsewhere.
- The sites you choose to capture. PIVOT loads them in a real browser.
- Third-party skills, plugins and MCP servers you install next to PIVOT.
