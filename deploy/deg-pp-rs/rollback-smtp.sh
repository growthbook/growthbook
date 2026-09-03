#!/usr/bin/env bash
# Restore the GrowthBook Helm release to the pre-SMTP values that were live
# on 2026-09-02. Does not delete the `smtp` secret if you created one.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VALUES="${ROOT}/deploy/deg-pp-rs/growthbook-values.rollback.yaml"

helm upgrade --install growthbook oci://ghcr.io/growthbook/charts/growthbook \
  --namespace growthbook \
  -f "${VALUES}"

kubectl rollout status deployment/growthbook-backend -n growthbook
kubectl rollout status deployment/growthbook-frontend -n growthbook

echo "Rolled back to pre-SMTP values. EMAIL_ENABLED is false again."
