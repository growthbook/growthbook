#!/usr/bin/env bash
# Publishes the script tag bundles to our CDN. The Script CDN workflows run
# this, and it can be run by hand for a release that has to be live before it
# is merged.
#
#   script-cdn.sh upload
#     Builds the bundles for this checkout's SDK version and uploads them to
#     /script/<version>/. That path never changes afterwards.
#
#   script-cdn.sh promote <version>
#     Makes an uploaded version the one served from /script/v<major>/.
#     Run it with an earlier version to roll back.
#
# Needs AWS credentials and SCRIPT_CDN_BUCKET. promote also needs
# FASTLY_API_TOKEN.
set -euo pipefail

BUCKET="${SCRIPT_CDN_BUCKET:?Set SCRIPT_CDN_BUCKET to the S3 bucket name}"
CDN_HOST="cdn.growthbook.io"

# max-age: browsers keep a bundle for a day, which is how long a release or a
# rollback takes to reach visitors. Shorter means more requests.
# s-maxage: the CDN keeps it for an hour. Keep this well under max-age:
# browsers subtract the time a file sat in the CDN (the Age header) from
# max-age, so a CDN lifetime near max-age leaves them rechecking on most page
# loads. promote also purges the CDN.
LIVE_CACHE="public, max-age=86400, s-maxage=3600, stale-while-revalidate=86400"

cd "$(dirname "$0")/.."

# copy <from> <to> <cache-control> [aws s3 cp flags]
# VERSION goes last, so finding it at the destination means every file is there.
copy() {
  local from="$1" to="$2" cache="$3" each
  shift 3
  for each in "*.js|application/javascript" "*.map|application/json" "VERSION|text/plain"; do
    aws s3 cp "$from" "$to" --recursive --exclude "*" --include "${each%%|*}" \
      --content-type "${each##*|}; charset=utf-8" --cache-control "$cache" "$@"
  done
}

list() {
  aws s3 ls "s3://$BUCKET/$1/" | awk '{print $4}' | sort
}

upload() {
  local version dest found out
  version=$(node -p "require('./package.json').version")
  dest="script/$version"

  if found=$(aws s3api head-object --bucket "$BUCKET" --key "$dest/VERSION" 2>&1); then
    echo "$version is already uploaded. A version is never replaced."
    return
  elif [[ "$found" != *"Not Found"* ]]; then
    # Anything but a 404 (no access, wrong bucket) must not be read as "not uploaded yet"
    echo "$found" >&2
    exit 1
  fi

  pnpm build:bundles
  out=$(mktemp -d)
  node scripts/stage-script-cdn.js "$out"
  copy "$out" "s3://$BUCKET/$dest" "public, max-age=31536000, immutable"
  echo "Uploaded $version to /$dest/"
}

promote() {
  local version="${1:-}" src live previous live_files file
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Usage: script-cdn.sh promote <version, for example 3.0.1>" >&2
    exit 1
  fi
  : "${FASTLY_API_TOKEN:?Set FASTLY_API_TOKEN to purge the CDN}"
  src="script/$version"
  live="script/v${version%%.*}"

  # Fails for a version that is missing or only partly uploaded
  aws s3api head-object --bucket "$BUCKET" --key "$src/VERSION" > /dev/null
  previous=$(aws s3 cp "s3://$BUCKET/$live/VERSION" - 2>/dev/null || echo "nothing")

  # Always copies every file. `aws s3 sync` would skip one whose size is
  # unchanged when the source is older, which is every rollback.
  copy "s3://$BUCKET/$src/" "s3://$BUCKET/$live/" "$LIVE_CACHE" --metadata-directive REPLACE

  # Remove what this version doesn't have, so a bundle that no longer exists
  # stops loading instead of staying on old code
  live_files=$(list "$live")
  comm -13 <(list "$src") <(echo "$live_files") | while read -r file; do
    aws s3 rm "s3://$BUCKET/$live/$file"
  done

  # Includes the files just removed
  while read -r file; do
    curl --fail --silent --show-error --request POST \
      --header "Fastly-Key: $FASTLY_API_TOKEN" \
      "https://api.fastly.com/purge/$CDN_HOST/$live/$file" > /dev/null
  done <<< "$live_files"

  echo "/$live/ now serves $version (was $previous)"
}

case "${1:-}" in
  upload) upload ;;
  promote) promote "${2:-}" ;;
  *)
    echo "Usage: script-cdn.sh upload | promote <version>" >&2
    exit 1
    ;;
esac
