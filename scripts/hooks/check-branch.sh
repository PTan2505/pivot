#!/bin/sh
# Pre-commit: main is production and dev is integration — work happens on task branches (see CLAUDE.md).
branch=$(git symbolic-ref --quiet --short HEAD)
case "$branch" in
  main|dev)
    echo "✗ Don't commit directly to '$branch'. Create a task branch from dev:"
    echo "    git switch dev && git pull --ff-only && git switch -c feat/<task>"
    echo "  (Bypass once with LEFTHOOK_EXCLUDE=branch git commit … if you really mean it.)"
    exit 1 ;;
esac
