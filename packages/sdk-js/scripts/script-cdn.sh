#!/usr/bin/env bash
# Publishes the script tag bundles to our CDN. The Script CDN workflows run
# this, and it can be run by hand for a release that has to be live before it
# is merged.
#
#   script-cdn.sh upload
#     Builds the bundles for this checkout's SDK version and uploads them to
#     /script/<version>/. A version that is already there is left alone.
#
#   script-cdn.sh promote <version>
#     Copies an uploaded version to /script/v<major>/, the path sites load.
#     Run it with an earlier version to roll back.
#
# Needs AWS credentials and SCRIPT_CDN_BUCKET. promote also needs
# FASTLY_API_TOKEN.
#
# Customer sites load /script/v<major>/, so keep these rules when changing
# this script:
#
# - It only writes. Nothing here deletes or empties anything. A bundle that a
#   later version drops stays at /script/v<major>/ on the last version that
#   had it.
# - A failed read from S3 stops the script. It is never taken to mean that
#   nothing is there.
# - Every step that matters checks its own result with `|| die`. `set -e` is
#   only a backstop: bash turns it off inside $(...), which is where the reads
#   happen.
# - VERSION is written last and only after the other files are checked, so a
#   path with a VERSION file has every file.
# - Stopping part way is safe, and running the same command again finishes
#   it. Each bundle is one file that loads nothing else, so a path that is
#   part one version and part another still serves working bundles.
#
# Runs on the bash 3.2 that macOS ships.
set -euo pipefail
export LC_ALL=C

BUCKET="${SCRIPT_CDN_BUCKET:?Set SCRIPT_CDN_BUCKET to the S3 bucket name}"
CDN_HOST="cdn.growthbook.io"
VERSION_FORMAT='^[0-9]+\.[0-9]+\.[0-9]+$'

VERSIONED_CACHE="public, max-age=31536000, immutable"
# max-age: browsers keep a bundle for a day, which is how long a release or a
# rollback takes to reach visitors. Shorter means more requests.
# s-maxage: the CDN keeps it for an hour. Keep this well under max-age:
# browsers subtract the time a file sat in the CDN (the Age header) from
# max-age, so a CDN lifetime near max-age leaves them rechecking on most page
# loads. promote also purges the CDN.
LIVE_CACHE="public, max-age=86400, s-maxage=3600, stale-while-revalidate=86400"

cd "$(dirname "$0")/.." || exit 1

die() {
  echo "Error: $*" >&2
  exit 1
}

# File lists are one "<name> <size>" line per file, sorted.

# remote_files <path>
# Prints nothing for a path with no files. Fails if S3 can't be read.
remote_files() {
  local found
  found=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$1/" \
    --query 'Contents[].[Key, Size]' --output text) || return 1
  if [[ -z "$found" || "$found" == "None" ]]; then
    return 0
  fi
  # Keys are "<path>/<name>". The S3 console's "Create folder" adds a key
  # that is only "<path>/", which is not a file.
  awk -v skip="${#1}" 'length($1) > skip + 1 { print substr($1, skip + 2), $2 }' \
    <<< "$found" | sort
}

# local_files <directory>
local_files() {
  local file size
  for file in "$1"/*; do
    size=$(wc -c < "$file") || return 1
    echo "$(basename "$file") $((size))"
  done | sort
}

# require_complete <file list> <what it lists>
# Stops unless the list is a whole version made only of files this script
# knows how to serve.
require_complete() {
  local names odd
  names=$(awk '{ print $1 }' <<< "$1")
  grep -qx "VERSION" <<< "$names" ||
    die "$2 has no VERSION file. It is missing or only partly uploaded."
  grep -qx "core.min.js" <<< "$names" || die "$2 has no core.min.js."
  odd=$(grep -vE '^(VERSION|[A-Za-z0-9._-]+\.(js|map))$' <<< "$names" || true)
  [[ -z "$odd" ]] || die "$2 has files this script doesn't expect: $odd"
}

# put <from> <to path> <cache-control> <file list>
# <from> is a local directory or an s3:// path.
put() {
  local from="$1" to="$2" cache="$3" name size type replace
  # A copy within S3 keeps the source's headers unless told to replace them
  replace=""
  if [[ "$from" == s3://* ]]; then
    replace="--metadata-directive REPLACE"
  fi
  while read -r name size; do
    case "$name" in
      *.js) type="application/javascript; charset=utf-8" ;;
      *.map) type="application/json; charset=utf-8" ;;
      VERSION) type="text/plain; charset=utf-8" ;;
      *) die "No content type is set for \"$name\"" ;;
    esac
    # shellcheck disable=SC2086 # $replace is two words, or none
    aws s3 cp "$from/$name" "s3://$BUCKET/$to/$name" \
      --content-type "$type" --cache-control "$cache" $replace < /dev/null ||
      die "Couldn't write /$to/$name. Nothing was removed. Run this again."
  done <<< "$4"
}

# write <from> <to path> <cache-control> <file list>
write() {
  local bundles marker written missing
  bundles=$(grep -v '^VERSION ' <<< "$4") || die "No bundles to write to /$2/"
  marker=$(grep '^VERSION ' <<< "$4") || die "No VERSION to write to /$2/"

  put "$1" "$2" "$3" "$bundles"

  written=$(remote_files "$2") ||
    die "Couldn't list /$2/ to check the files just written."
  missing=$(comm -23 <(echo "$bundles") <(echo "$written"))
  [[ -z "$missing" ]] ||
    die "/$2/ is missing these files, or has them at a different size: $missing"

  put "$1" "$2" "$3" "$marker"
}

upload() {
  local version dest uploaded staged files
  version=$(node -p "require('./package.json').version") ||
    die "Couldn't read the SDK version."
  [[ "$version" =~ $VERSION_FORMAT ]] ||
    die "Can't upload $version. Only x.y.z versions go on the CDN."
  dest="script/$version"

  uploaded=$(remote_files "$dest") ||
    die "Couldn't list /$dest/, so can't tell whether $version is already" \
      "there. Nothing was uploaded."
  if grep -q '^VERSION ' <<< "$uploaded"; then
    echo "$version is already uploaded. A version is never replaced."
    return 0
  fi

  pnpm build:bundles || die "The build failed. Nothing was uploaded."
  staged=$(mktemp -d) || die "Couldn't create a temporary directory."
  node scripts/stage-script-cdn.js "$staged" ||
    die "Couldn't stage the bundles. Nothing was uploaded."
  files=$(local_files "$staged") || die "Couldn't read the staged bundles."
  require_complete "$files" "The build"

  write "$staged" "$dest" "$VERSIONED_CACHE" "$files"
  echo "Uploaded $version to /$dest/"
}

promote() {
  local version="${1:-}" src live files marker live_files previous name size
  local unpurged=""
  [[ "$version" =~ $VERSION_FORMAT ]] ||
    die "Usage: script-cdn.sh promote <version, for example 3.0.1>"
  [[ -n "${FASTLY_API_TOKEN:-}" ]] ||
    die "Set FASTLY_API_TOKEN to purge the CDN."
  src="script/$version"
  live="script/v${version%%.*}"

  files=$(remote_files "$src") || die "Couldn't list /$src/. Nothing changed."
  require_complete "$files" "/$src/"
  marker=$(aws s3 cp "s3://$BUCKET/$src/VERSION" -) ||
    die "Couldn't read /$src/VERSION. Nothing changed."
  [[ "$marker" == "$version" ]] ||
    die "/$src/VERSION says \"$marker\", not $version. Nothing changed."

  live_files=$(remote_files "$live") ||
    die "Couldn't list /$live/. Nothing changed."
  previous="nothing"
  if grep -q '^VERSION ' <<< "$live_files"; then
    previous=$(aws s3 cp "s3://$BUCKET/$live/VERSION" -) ||
      die "Couldn't read /$live/VERSION. Nothing changed."
  fi

  write "s3://$BUCKET/$src" "$live" "$LIVE_CACHE" "$files"
  echo "/$live/ now has $version (was $previous)"

  # The copy is finished. A purge only makes the CDN serve it now instead of
  # within the hour, so one that fails is reported and changes nothing.
  while read -r name size; do
    curl --fail --silent --show-error --retry 3 --max-time 30 --request POST \
      --header "Fastly-Key: $FASTLY_API_TOKEN" \
      "https://api.fastly.com/purge/$CDN_HOST/$live/$name" \
      > /dev/null < /dev/null || unpurged="$unpurged $name"
  done <<< "$files"
  [[ -z "$unpurged" ]] ||
    die "The CDN purge failed for:$unpurged. Sites still get $version within" \
      "the hour. Run this again to purge now."
}

case "${1:-}" in
  upload) upload ;;
  promote) promote "${2:-}" ;;
  *) die "Usage: script-cdn.sh upload | promote <version>" ;;
esac
