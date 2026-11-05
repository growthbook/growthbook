#!/usr/bin/env bash
# Prints the files between two revisions that change the cloud image (Deploy's old `paths` filter).
set -euo pipefail
git diff --name-only "$1" "$2" -- \
  .github/workflows/deploy.yml .github/workflows/build-image.yml \
  packages ':(exclude,glob)**/*.md' pnpm-lock.yaml Dockerfile .dockerignore
