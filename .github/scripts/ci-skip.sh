#!/bin/bash

shopt -s nocasematch

# Only check for line:
CHECKED=`echo "${COMMIT_MESSAGE}" | head -n 1`

echo "Checking ${CHECKED}"

if [[ "${CHECKED}}" =~ CI\ SKIP ]]; then
  echo "CI skip!"
  echo "ci_skip=true" >> "${GITHUB_OUTPUT}"
  exit 0
fi

if [[ "${CHECKED}" =~ CI_SKIP ]]; then
  echo "CI skip!"
  echo "ci_skip=true" >> "${GITHUB_OUTPUT}"
  exit 0
fi

echo "Proceed with CI"
