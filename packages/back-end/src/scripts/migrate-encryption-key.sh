#!/bin/bash
# Wrapper script to run migrate-encryption-key with ts-node (dev) or node (production)
# In dev the dist file might not be built, and if yarn dev is running swc compilation breaks, which is why we need ts-node there.
if command -v ts-node >/dev/null 2>&1; then
  ts-node src/scripts/migrate-encryption-key.ts "$@"
else
  node dist/scripts/migrate-encryption-key.js "$@"
fi
