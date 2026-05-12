#!/bin/sh
# Workaround for two separate stdin-parsing bugs in the bundled `claude` Bun
# binary that surface as "SyntaxError: JSON Parse error: Unterminated string":
#
#   1. When stdin is a Node child_process pipe, the binary drops bytes on
#      user-message JSON lines roughly 220-280 KB long following an SDK
#      `initialize` control_request.
#   2. When stdin is a regular file FD, the binary fails on lines roughly
#      280-300 KB long.
#
# Shell pipes from `cat` to the binary pass every size we tested. So:
#   - drain Node's pipe stdin to a tempfile via `cat` (avoid bug 1),
#   - then pipe that tempfile back into the real binary via another `cat`
#     so the binary's stdin is a kernel pipe, not a file FD (avoid bug 2).
#
# See docs/plans/2026-05-12-05-claude-stdin-wrapper.md.
set -eu

: "${CLAUDE_REAL_BIN:?CLAUDE_REAL_BIN must point at the real claude binary}"

TMP=$(mktemp -t claude-stdin.XXXXXX)
trap 'rm -f "$TMP"' EXIT INT TERM HUP

cat > "$TMP"
cat "$TMP" | "$CLAUDE_REAL_BIN" "$@"
