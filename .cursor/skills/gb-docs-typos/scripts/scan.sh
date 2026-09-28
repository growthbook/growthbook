#!/usr/bin/env bash
# Typo scan covering the classes in github.com/growthbook/growthbook/pull/7158.
# Usage: bash .cursor/skills/gb-docs-typos/scripts/scan.sh
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"
here="$(cd "$(dirname "$0")" && pwd)"
extra_dict="$here/misspellings.txt"

codespell_bin=""
if command -v codespell >/dev/null 2>&1; then
  codespell_bin="codespell"
elif [[ -x "$HOME/Library/Python/3.9/bin/codespell" ]]; then
  codespell_bin="$HOME/Library/Python/3.9/bin/codespell"
elif python3 -m codespell --help >/dev/null 2>&1; then
  codespell_bin="python3 -m codespell"
fi

skip="*.png,*.jpg,*.svg,*.gif,*.lock,*.woff,*.woff2,node_modules,dist,.git,.husky"

echo "=== codespell (builtin dict + extras codespell does not know) ==="
if [[ -z "$codespell_bin" ]]; then
  echo "codespell not installed. pip install --user codespell"
else
  $codespell_bin \
    --dictionary="-,${extra_dict}" \
    --skip="$skip" \
    README.md CONTRIBUTING.md docs packages \
    2>/dev/null || true
fi

echo
echo "=== doubled words ==="
rg -n --glob '!**/node_modules/**' --glob '!**/dist/**' \
  '\b(the the|to to|and and|of of|a a|or or|in in|is is|for for|as as|are are)\b' \
  README.md CONTRIBUTING.md docs packages || true

echo
echo "=== split / closed compounds (codespell misses these) ==="
rg -n --glob '!**/node_modules/**' --glob '!**/dist/**' \
  -e '\batleast\b' \
  -e '\beverytime\b' \
  -e '\bWhich ever\b' \
  -e '\bwhich ever\b' \
  -e '\bstraight forward\b' \
  -e '\bwith in\b' \
  -e '\byour self\b' \
  -e '\bnumberline\b' \
  README.md CONTRIBUTING.md docs packages || true

echo
echo "=== verb used as closed compound ==="
rg -n --glob '*.md' --glob '*.mdx' \
  -e '\bget you setup\b' \
  -e '\bget this setup\b' \
  -e '\bhow to setup\b' \
  -e '\bto setup\b' \
  -e '\balso setup\b' \
  -e '\bsetup your\b' \
  -e '\bsetup the\b' \
  -e '\bwill setup\b' \
  -e '\bto login\b' \
  README.md CONTRIBUTING.md docs || true

echo
echo "=== a/an, Lets, possessives ==="
rg -n --glob '*.md' --glob '*.mdx' \
  -e '\ba (alternate|SDK|experiment|event|array|object|option|instance|attribute|error|id)\b' \
  -e '\ban (user|unique|one|metric|feature|flag|test|boolean|number|string|hash)\b' \
  -e '\bOnce a SDK\b' \
  -e '\bConfiguring a SDK\b' \
  -e "\bit's own\b" \
  -e '\ba users\b' \
  -e '\byour organizations\b' \
  -e '\bAmplitudes\b' \
  -e '\bTwymans\b' \
  -e "\bLets [a-z]" \
  -e "\blets [a-z]" \
  README.md CONTRIBUTING.md docs || true
