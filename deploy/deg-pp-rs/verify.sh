#!/usr/bin/env bash
# Verify GrowthBook public routing on deg-pp-rs.
# Usage:  ./verify.sh            (checks current state)
#         ./verify.sh --churn    (also deletes the frontend pod to prove self-healing)
set -uo pipefail

CTX_NS=growthbook
UI_HOST=growthbook-ui.deg-pp-rs.k8s.otenv.com
API_HOST=growthbook-api.deg-pp-rs.k8s.otenv.com
fail=0

hr() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ck() { if [ "$1" = ok ]; then printf '  \033[32mPASS\033[0m %s\n' "$2"; else printf '  \033[31mFAIL\033[0m %s\n' "$2"; fail=1; fi; }

hr "1. alias Services have endpoints (selector is matching pods)"
for svc in growthbook-frontend-lis growthbook-backend-lis; do
  eps=$(kubectl -n "$CTX_NS" get endpoints "$svc" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null)
  [ -n "$eps" ] && ck ok "$svc -> $eps" || ck no "$svc has NO endpoints (selector wrong?)"
done

hr "2. ot entries are ExternalName (not ClusterIP + pinned Endpoints)"
for svc in growthbook-ui growthbook-api; do
  t=$(kubectl -n ot get svc "$svc" -o jsonpath='{.spec.type}' 2>/dev/null)
  [ "$t" = ExternalName ] && ck ok "ot/$svc type=ExternalName" || ck no "ot/$svc type=$t (expected ExternalName)"
done

hr "3. no hand-pinned Endpoints remain anywhere in the cluster"
pinned=$(kubectl get endpointslices -A \
  -l endpointslice.kubernetes.io/managed-by=endpointslicemirroring-controller.k8s.io \
  --no-headers 2>/dev/null | grep -i growthbook)
[ -z "$pinned" ] && ck ok "none for growthbook" || ck no "still pinned:
$pinned"

hr "4. public URLs respond"
for h in "$UI_HOST" "$API_HOST"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 25 "https://$h/" 2>/dev/null)
  case "$code" in
    2*|3*) ck ok "https://$h -> $code" ;;
    502)   ck no "https://$h -> 502 (edge cannot reach upstream)" ;;
    *)     ck no "https://$h -> $code" ;;
  esac
done

if [ "${1:-}" = --churn ]; then
  hr "5. CHURN TEST - deleting frontend pod to prove self-healing"
  old=$(kubectl -n "$CTX_NS" get pod -l app.kubernetes.io/component=frontend \
        -o jsonpath='{.items[0].status.podIP}')
  echo "  old pod IP: $old"
  kubectl -n "$CTX_NS" delete pod -l app.kubernetes.io/component=frontend --wait=true >/dev/null
  kubectl -n "$CTX_NS" rollout status deploy/growthbook-frontend --timeout=180s >/dev/null
  new=$(kubectl -n "$CTX_NS" get pod -l app.kubernetes.io/component=frontend \
        -o jsonpath='{.items[0].status.podIP}')
  echo "  new pod IP: $new"
  [ "$old" != "$new" ] && ck ok "pod IP changed ($old -> $new)" \
                       || ck no "pod IP did not change; test inconclusive"
  sleep 20
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 25 "https://$UI_HOST/" 2>/dev/null)
  case "$code" in
    2*|3*) ck ok "URL still works after IP change -> $code  (SELF-HEALING CONFIRMED)" ;;
    *)     ck no "URL broke after IP change -> $code" ;;
  esac
fi

hr "result"
[ "$fail" -eq 0 ] && { echo "  all checks passed"; exit 0; } || { echo "  one or more checks FAILED"; exit 1; }
