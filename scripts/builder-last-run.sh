#!/bin/sh
# Runs the static builder and records how the run ended, for the admin (#405):
#   builder-last-run.sh micelio-builder generate
# The result goes to the file REBUILD_STATUS_FILE names, replaced as a whole when the run ends:
#   exit=<code>
#   finished=<UTC time>
#   site_before=<1 when the output directory held a site before the run, else 0>
#   <the builder's stderr lines that start with "Static theme: " or "micelio-builder: the generation failed; ">
# Nothing else of the output is kept, and the CMS reader shows none of it as written: it parses the
# lines into codes of a closed list and the admin builds the sentence from those.
# The builder's own output is not changed and the exit code is the builder's. Without REBUILD_STATUS_FILE it just runs the command.
# docs/architecture/demo-instances.md, "The builder's last run"
set -u

if [ -z "${REBUILD_STATUS_FILE:-}" ]; then
  exec "$@"
fi

# Without a scratch directory the run still happens, unrecorded: the exit code stays the builder's
work="$(mktemp -d)" || exec "$@"
trap 'rm -rf "$work"' EXIT

# Whether a site is there to be kept if this run fails (the builder's failure line says it is, always)
site_before=0
if [ -n "$(ls -A "${OUT_DIR:-/out}" 2>/dev/null)" ]; then site_before=1; fi

# stderr goes to the terminal as it is written and to a file; the exit code travels in a file because
# a pipeline reports the code of its last command only
{
  {
    "$@"
    echo $? >"$work/code"
  } 2>&1 1>&3 | tee "$work/stderr" >&2
} 3>&1
code="$(cat "$work/code" 2>/dev/null || echo 1)"

{
  echo "exit=$code"
  echo "finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "site_before=$site_before"
  # The failure line quotes "Static theme: ..." itself, so it is taken whole before the reasons are cut out
  sed -n -e '/^micelio-builder: the generation failed; /{p;d;}' -e 's/^.*\(Static theme: .*\)$/\1/p' "$work/stderr" |
    awk '!seen[$0]++ && ++lines <= 20'
} >"$work/status"

chmod 644 "$work/status"
# Same directory, so the rename is atomic: the CMS never reads half a file
temp="$REBUILD_STATUS_FILE.$$"
if cp "$work/status" "$temp" && mv -f "$temp" "$REBUILD_STATUS_FILE"; then
  :
else
  rm -f "$temp"
  echo "builder-last-run: could not write the status file; the run itself is unchanged." >&2
fi
exit "$code"
