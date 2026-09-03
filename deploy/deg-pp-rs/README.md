# GrowthBook public routing — deg-pp-rs

Replaces the hand-pinned-pod-IP routing hack with a self-healing setup.

## The problem this fixes

`lis` maps `https://<name>.deg-pp-rs.k8s.otenv.com` → Service `<name>` in namespace `ot`, and
connects on **port 80**. GrowthBook's Services listen on 3000/3100, and a Service in `ot` cannot
select pods in `growthbook` (selectors don't cross namespaces). The original setup worked around
that with a selector-less Service plus a **hand-written `Endpoints` object holding a literal pod
IP**.

Nothing updates a literal. When a pod is rescheduled it gets a new IP, the pinned endpoint
orphans itself, and the URL returns **502 while the pods still show `Running`** — so the app
looks healthy and pod logs are silent, because traffic never reaches the pod.

This happened twice unnoticed: frontend pod rescheduled 2026-08-10, backend 2026-08-22. Neither
was a deploy — the ReplicaSets hadn't changed since 2026-05-14. Ordinary node churn was enough.

## The fix

Two links, neither containing a human-written IP:

```
ot/growthbook-ui  (ExternalName)
  └─> "growthbook-frontend-lis.growthbook.svc.deg-pp-rs"   a NAME, resolved per lookup
       growthbook/growthbook-frontend-lis  (ClusterIP, port 80, + selector)
         └─> pods  <- endpoints rewritten automatically by Kubernetes on every pod change
```

## Apply

Run from this directory. Steps 2 and 4 are the only ones that change anything.

### 1. Back up the current state

```bash
kubectl -n ot get svc,endpoints,ingress growthbook-ui growthbook-api \
  -o yaml > ~/growthbook-ot-backup-$(date +%F).yaml
```

### 2. Create the port-80 aliases (purely additive — no effect on live traffic)

```bash
kubectl apply -f 01-lis-alias-services.yaml
```

### 3. Verify the aliases before touching `ot`

```bash
kubectl -n growthbook get endpoints growthbook-frontend-lis growthbook-backend-lis
```

Both must list a current pod IP on `:3000` / `:3100`. **If either is empty, stop** — the selector
isn't matching, and continuing would take down a URL that the next step would otherwise fix.

Optional direct proof:

```bash
kubectl -n growthbook port-forward svc/growthbook-frontend-lis 18080:80
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/    # expect 200
```

### 4. Convert the `ot` entries to ExternalName

```bash
kubectl apply -f 02-ot-externalname-services.yaml
```

`kubectl apply` converts `ClusterIP` → `ExternalName` in place, clearing `clusterIP` and `ports`.
No delete needed (verified with `--dry-run=server`).

### 5. Remove the leftovers

The `Endpoints` objects were created by hand, so they are not garbage-collected with the Service —
delete them explicitly or they linger and keep the stale IPs visible:

```bash
kubectl -n ot delete endpoints growthbook-ui growthbook-api --ignore-not-found
kubectl -n ot delete ingress   growthbook-ui growthbook-api --ignore-not-found
```

The Ingresses are inert here: `lis` routes on the `ot` **Service** name, not Ingress. `grafana`,
`dag-airflow`, `dw-airflow`, `gcbi-airflow`, `flux-operator-ui` and `whisker` all work with an
`ot` ExternalName and **no** `ot` Ingress, while `hub-streamlit` and `ds-qdrant` have Ingresses in
their own namespaces and return 502.

> Fallback: if the URLs don't come up, re-apply just those two Ingresses from the backup. That
> would mean `lis` treats GrowthBook differently from the other ~30 `ot` entries.

### 6. Verify

```bash
./verify.sh
```

Checks alias endpoints, `ot` Service types, absence of hand-pinned endpoints cluster-wide, and
both public URLs.

## Prove it self-heals

Once green, force the exact failure that caused the outage:

```bash
./verify.sh --churn
```

This deletes the frontend pod, waits for the rollout, confirms the pod IP **changed**, and
re-checks the URL. A pass here is the guarantee that no future reschedule needs manual work.

## Rollback

```bash
kubectl apply -f ~/growthbook-ot-backup-$(date +%F).yaml
```

Note the backed-up `Endpoints` contain the *stale* IPs, so to actually serve traffic you'd also
need to re-patch them to current pod IPs — which is the fragility this change removes.

## Do not reintroduce

Any procedure containing `kubectl get pods -o wide` followed by pasting an IP into an `Endpoints`
object rebuilds this outage. If a new host is needed, add a port-80 alias Service in the workload
namespace and an `ot` ExternalName pointing at it.

`helm upgrade` does **not** need to run for any of this, and no pods restart. Keep
`ingress.enabled: false` in `growthbook-values.yaml` — the chart's Ingress template does nothing
on this platform.
