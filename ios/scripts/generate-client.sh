#!/usr/bin/env bash
# Regenerate the Swift API client from the Zod-derived OpenAPI specs (docs/ios-app.md §8).
#
#   ios/scripts/generate-client.sh
#
# 1. `npm run openapi:build` writes openapi/{module}.json (build output, gitignored).
# 2. swift-openapi-generator (pinned in ios/Tools) turns each spec into Types.swift + Client.swift
#    under ios/JMWClient/Sources/{Module}API/Generated/, which IS committed — so a Swift build never
#    needs Node, and an API change shows up as a reviewable diff next to the route change.
#
# Run it after any change to a module's schema or scripts/build-openapi.ts; a clean `git diff` after
# running it means the client is in sync.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"

npm run --silent openapi:build

modules=(macros weight lifting rides vitals shopping)
for module in "${modules[@]}"; do
  name="$(tr '[:lower:]' '[:upper:]' <<< "${module:0:1}")${module:1}API"
  out="ios/JMWClient/Sources/$name/Generated"
  mkdir -p "$out"
  log="$(mktemp)"
  # The generator is chatty on stderr; show its output only when it fails.
  if ! swift run --package-path ios/Tools --quiet swift-openapi-generator generate \
    "openapi/$module.json" \
    --config ios/JMWClient/openapi-generator-config.yaml \
    --output-directory "$out" > "$log" 2>&1; then
    cat "$log"
    exit 1
  fi
  if grep -qiE "warning|error" "$log"; then grep -iE "warning|error" "$log"; fi
  rm -f "$log"
  echo "Generated $out"
done
