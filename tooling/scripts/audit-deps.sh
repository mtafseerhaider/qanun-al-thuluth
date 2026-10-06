#!/usr/bin/env bash
# tooling/scripts/audit-deps.sh
#
# Dependency vulnerability gate (MASVS-CODE-3, docs/security/masvs-l1-checklist.md): fails on any high or
# critical advisory in production dependencies (`pnpm audit --audit-level high --prod`). Advisories accepted
# after review are listed in package.json `pnpm.auditConfig.ignoreGhsas`, each with its reason in the checklist.
#
# Not flaky: a registry or network error is retried (3 attempts, 10 s then 20 s back-off). Only a completed
# audit that reports vulnerabilities at or above the level fails at once. If the registry stays unreachable
# the step fails with a distinct message so it is not mistaken for a finding.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

for attempt in 1 2 3; do
  out="$(pnpm audit --audit-level high --prod 2>&1)"
  code=$?
  printf '%s\n' "$out"
  if [ "$code" -eq 0 ]; then
    exit 0
  fi
  # A completed audit prints its summary ("N vulnerabilities found"); anything else is a tooling error.
  if grep -qE '[0-9]+ vulnerabilit(y|ies) found' <<<"$out"; then
    echo "::error::pnpm audit: high or critical advisories in production dependencies (see above)"
    exit 1
  fi
  if [ "$attempt" -lt 3 ]; then
    echo "::warning::pnpm audit did not complete (attempt $attempt, exit $code); retrying"
    sleep $((attempt * 10))
  fi
done
echo "::error::pnpm audit could not reach the registry after 3 attempts (not a vulnerability finding)"
exit 2
