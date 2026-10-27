#!/bin/sh
# Pre-commit: refuse staged secrets — .env files (Neon URL, R2 keys) and the extension signing key.
bad=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '(^|/)\.env($|\.)|\.pem$|\.crx$' | grep -v '\.env\.example$')
if [ -n "$bad" ]; then
  echo "✗ These files must not be committed:"
  echo "$bad" | sed 's/^/    /'
  echo "  Unstage them with: git restore --staged <file>"
  exit 1
fi
