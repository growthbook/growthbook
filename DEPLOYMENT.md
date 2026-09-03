# GrowthBook on deg-pp-rs

How we run GrowthBook on our Kubernetes cluster. Written during the initial POC setup in May 2026.

## Overview

GrowthBook runs in the `growthbook` namespace with two deployments (frontend on port 3000, backend on port 3100). It connects to our external MongoDB replica set. Traffic comes in through the frontdoor in the `ot` namespace.

```
Browser
  ├─ growthbook-ui.deg-pp-rs.k8s.otenv.com  → frontend (3000)
  └─ growthbook-api.deg-pp-rs.k8s.otenv.com → backend  (3100)

Frontdoor (ot) → ClusterIP + Endpoints (ot) → Pods (growthbook) → MongoDB (external)
```

MongoDB hosts:
- growthbook-mongo-01-pp-rs.otenv.com
- growthbook-mongo-02-pp-rs.otenv.com
- growthbook-mongo-03-pp-rs.otenv.com

## Setup from scratch

### 1. Namespace and secrets

```bash
kubectl create namespace growthbook

# Generate keys
openssl rand -hex 32   # for JWT_SECRET
openssl rand -hex 32   # for ENCRYPTION_KEY

kubectl create secret generic jwt-secret \
  --from-literal=jwt-secret=<YOUR_JWT_SECRET> \
  -n growthbook

kubectl create secret generic encryption-key \
  --from-literal=encryption-key=<YOUR_ENCRYPTION_KEY> \
  -n growthbook
```

For the MongoDB URI, you need to URL-encode special characters in the password (`/` → `%2F`, `=` → `%3D`):

```bash
kubectl create secret generic mongodb-uri \
  --from-literal=uri="mongodb://GrowthbookUser:<URL_ENCODED_PASSWORD>@growthbook-mongo-01-pp-rs.otenv.com:27017,growthbook-mongo-02-pp-rs.otenv.com:27017,growthbook-mongo-03-pp-rs.otenv.com:27017/Growthbook?authSource=Growthbook" \
  -n growthbook
```

**Watch out:** The database name is `Growthbook` with a capital G. The `authSource` is also `Growthbook`. We burned time on this because `growthbook` (lowercase) gives you a cryptic `AuthenticationFailed` with no hint about case sensitivity.

### 2. Test MongoDB connectivity

Before deploying, make sure the credentials actually work:

```bash
kubectl run mongo-test --image=mongo:6 -n growthbook --restart=Never -- sleep 3600
kubectl wait --for=condition=Ready pod/mongo-test -n growthbook --timeout=120s

kubectl exec -it mongo-test -n growthbook -- mongosh \
  --host growthbook-mongo-01-pp-rs.otenv.com \
  --port 27017 \
  --username GrowthbookUser \
  --password '<RAW_PASSWORD>' \
  --authenticationDatabase Growthbook \
  Growthbook

# Clean up when done
kubectl delete pod mongo-test -n growthbook
```

You should get a `Growthbook>` prompt. If you get `AuthenticationFailed`, double-check the password, username case, and auth database.

### 3. Helm values

Save this as `growthbook-values.yaml`:

```yaml
global:
  env:
    - name: APP_ORIGIN
      value: "https://growthbook-ui.deg-pp-rs.k8s.otenv.com"
    - name: NODE_ENV
      value: "production"

frontend:
  image:
    tag: "4.3.0"
  env:
    - name: API_HOST
      value: "https://growthbook-api.deg-pp-rs.k8s.otenv.com"

backend:
  image:
    tag: "4.3.0"
  mongodbEnabled: false
  volumeClaim:
    enabled: false
  env:
    - name: MONGODB_URI
      valueFrom:
        secretKeyRef:
          name: mongodb-uri
          key: uri
    - name: JWT_SECRET
      valueFrom:
        secretKeyRef:
          name: jwt-secret
          key: jwt-secret
    - name: ENCRYPTION_KEY
      valueFrom:
        secretKeyRef:
          name: encryption-key
          key: encryption-key
    - name: EMAIL_ENABLED
      value: "false"
    - name: UPLOAD_METHOD
      value: local

mongodb:
  enabled: false

ingress:
  enabled: false
```

Why certain things are set the way they are:

- **`image.tag` is explicit** — the Helm chart's server subchart has a stale `appVersion: "3.5.0"` baked in. If you don't override it, you'll pull an old image where `pm2-runtime` is in a different location and the pod crashes on startup.
- **`mongodb.enabled: false`** and **`mongodbEnabled: false`** — we use our own MongoDB, not the bundled Bitnami one. The first disables the Bitnami subchart, the second stops the chart from auto-generating a `MONGODB_URI` pointing at it.
- **`volumeClaim.enabled: false`** — our cluster nodes don't have PVs available for dynamic provisioning. Without this, the backend pod gets stuck in `Pending` forever. Downside: uploaded images don't survive pod restarts. Switch to S3 when that matters.
- **`ingress.enabled: false`** — we handle routing ourselves through the `ot` namespace.
- **`MONGODB_URI` via secretKeyRef** — the chart's built-in `mongodbUri` field renders the connection string (with credentials) as plaintext in the Deployment spec. Passing it through `backend.env` with a secret reference keeps it out of `kubectl get deploy -o yaml` output.

### 4. Deploy

```bash
helm upgrade --install growthbook oci://ghcr.io/growthbook/charts/growthbook \
  --version 4.3.1 \
  --namespace growthbook \
  -f growthbook-values.yaml
```

`--version` is required, not optional — see [Upgrading](#upgrading).

Check it worked:

```bash
kubectl get pods -n growthbook
kubectl logs deployment/growthbook-backend -n growthbook --tail=20
```

Both pods should be `1/1 Running`. The backend logs should show `Back-end is running at http://localhost:3100 in production mode` without any MongoDB errors.

### 5. Routing through the frontdoor

`lis` maps `https://<name>.deg-pp-rs.k8s.otenv.com` → Service `<name>` in namespace `ot`, and
connects on **port 80**. A Service in `ot` cannot select pods in `growthbook` (selectors don't
cross namespaces), and GrowthBook's Services listen on 3000/3100.

The setup is two links, neither containing a human-written IP:

```
ot/growthbook-ui  (ExternalName)
  └─> "growthbook-frontend-lis.growthbook.svc.deg-pp-rs"   a NAME, resolved per lookup
       growthbook/growthbook-frontend-lis  (ClusterIP, port 80, + selector)
         └─> pods  <- endpoints rewritten automatically by Kubernetes on every pod change
```

Apply it:

```bash
cd deploy/deg-pp-rs
kubectl apply -f 01-lis-alias-services.yaml     # port-80 aliases, additive
kubectl apply -f 02-ot-externalname-services.yaml
./verify.sh
```

**See `deploy/deg-pp-rs/README.md` for the full procedure**, including the backup step, the
mid-way check that must pass before you touch `ot`, and rollback.

> **Do not use a selector-less Service plus a hand-written `Endpoints` object holding a literal
> pod IP.** That was the original approach and it caused two silent outages (frontend 2026-08-10,
> backend 2026-08-22): nothing updates a literal, so a rescheduled pod orphans the endpoint and
> the URL returns **502 while pods still show `Running`**. Ordinary node churn is enough to
> trigger it — no deploy required.

The `ot` Ingress objects are inert on this platform — `lis` routes on the `ot` **Service** name,
not Ingress. Keep `ingress.enabled: false` in the values.

Hit the UI URL in a browser. You should see the GrowthBook login/setup page.

## Day-to-day operations

### Routing is self-healing

Pod restarts, node drains, rollouts and scaling need **no manual routing step**. The alias
Services in `growthbook` select pods by label, so Kubernetes' endpoint controller rewrites their
endpoints within seconds of any pod change, and the `ot` ExternalName entries point at a DNS
*name* that is re-resolved per lookup. No pod IP is written down anywhere.

Confirm at any time:

```bash
./deploy/deg-pp-rs/verify.sh
```

To prove self-healing by forcing the exact failure that caused the old outages (deletes the
frontend pod, confirms its IP changed, re-checks the URL):

```bash
./deploy/deg-pp-rs/verify.sh --churn
```

Two things that *would* break routing: a chart upgrade that renames the
`app.kubernetes.io/{name,instance,component}` pod labels the aliases select on, or someone
deleting the `-lis` / ExternalName objects — they are `kubectl`-applied from `deploy/deg-pp-rs/`
and are not part of the Helm release, so nothing reconciles them back.

### Runbook: the URL is down

**A pod IP changing is not a cause.** That is handled automatically, so do not start by looking up
pod IPs, and never fix this by writing an IP into an `Endpoints` object — that is what caused the
two outages this setup replaced.

Start here. It tells you which of the four links is broken:

```bash
./deploy/deg-pp-rs/verify.sh
```

Then fix by which check failed.

**Check 1 failed — `growthbook-frontend-lis has NO endpoints (selector wrong?)`**

The alias Service isn't matching any pod. Either no pod is running, or its labels changed.

```bash
kubectl -n growthbook get pods                                    # Running?
kubectl -n growthbook get pods --show-labels                      # compare against:
kubectl -n growthbook get svc growthbook-frontend-lis -o jsonpath='{.spec.selector}'; echo
```

- Pods not `Running` → this is an app problem, not routing. See [Troubleshooting](#troubleshooting).
- Pods `Running` but labels don't match the selector → a chart upgrade renamed them. Either roll
  the chart back to the pinned version, or update the `selector` in
  `01-lis-alias-services.yaml` to the new labels and re-apply. Do **not** switch to pinned IPs.

**Check 2 failed — `ot/growthbook-ui type=ClusterIP (expected ExternalName)`**

Someone recreated the old-style Service. Re-apply the correct one:

```bash
kubectl apply -f deploy/deg-pp-rs/02-ot-externalname-services.yaml
```

**Check 3 failed — `still pinned:`**

Stale hand-written `Endpoints` are shadowing the ExternalName. Delete them:

```bash
kubectl -n ot delete endpoints growthbook-ui growthbook-api --ignore-not-found
```

**Check 4 failed but 1–3 passed — URL returns 502 with everything green**

The in-cluster path is fine, so the problem is between `lis` and the alias Service. Prove the
alias works, bypassing the edge entirely:

```bash
kubectl -n growthbook port-forward svc/growthbook-frontend-lis 18080:80
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/    # expect 200
```

- 200 here → the workload and alias are healthy; escalate to the platform team about `lis`.
  Include that `ot/growthbook-ui` is an ExternalName pointing at
  `growthbook-frontend-lis.growthbook.svc.deg-pp-rs`, and that ~30 other `ot` entries use the
  same pattern.
- Not 200 here → the pod itself isn't serving; check `kubectl logs`.

Also confirm the ExternalName target resolves in-cluster (the DNS domain is `deg-pp-rs`, **not**
`cluster.local` — a wrong suffix here is silent and looks exactly like an edge fault):

```bash
kubectl -n growthbook exec deploy/growthbook-backend -- \
  getent hosts growthbook-frontend-lis.growthbook.svc.deg-pp-rs
```

**Last resort — rebuild both links from scratch.** Both files are declarative and safe to
re-apply at any time; neither restarts a pod, and no `helm upgrade` is needed:

```bash
kubectl apply -f deploy/deg-pp-rs/01-lis-alias-services.yaml
kubectl apply -f deploy/deg-pp-rs/02-ot-externalname-services.yaml
./deploy/deg-pp-rs/verify.sh
```

### Upgrading

Bump `image.tag` in `growthbook-values.yaml`, then:

```bash
helm upgrade --install growthbook oci://ghcr.io/growthbook/charts/growthbook \
  --version 4.3.1 \
  --namespace growthbook \
  -f growthbook-values.yaml

kubectl rollout status deployment/growthbook-frontend -n growthbook
kubectl rollout status deployment/growthbook-backend -n growthbook
./deploy/deg-pp-rs/verify.sh
```

**Always pass `--version`.** The release is on chart `4.3.1`; latest published is `5.0.1`, so an
unpinned `helm upgrade` silently bumps the chart as a side effect of an unrelated change. Chart
template changes can rename the pod labels the routing aliases select on.

### Rotating MongoDB credentials

```bash
kubectl delete secret mongodb-uri -n growthbook

kubectl create secret generic mongodb-uri \
  --from-literal=uri="mongodb://USER:URL_ENCODED_PASS@growthbook-mongo-01-pp-rs.otenv.com:27017,growthbook-mongo-02-pp-rs.otenv.com:27017,growthbook-mongo-03-pp-rs.otenv.com:27017/Growthbook?authSource=Growthbook" \
  -n growthbook

kubectl rollout restart deployment/growthbook-backend -n growthbook
```

### Reading secrets back

```bash
kubectl get secret mongodb-uri -n growthbook -o jsonpath='{.data.uri}' | base64 -d
```

Note: K8s secrets are base64-encoded, not encrypted. Anyone with namespace access can read them.

### Logs

```bash
kubectl logs deployment/growthbook-frontend -n growthbook --tail=50
kubectl logs deployment/growthbook-backend -n growthbook --tail=50
```

### Rollback SMTP (restore last-known-good Helm values)

The file `deploy/deg-pp-rs/growthbook-values.rollback.yaml` is a copy of the live Helm values from 2026-09-02, before SMTP. If a SMTP deploy breaks the backend:

```bash
./deploy/deg-pp-rs/rollback-smtp.sh
```

That re-applies Helm with `EMAIL_ENABLED: false` and no `smtp` secret references.

## Troubleshooting

| What you see | What's wrong | What to do |
|---|---|---|
| Backend `CrashLoopBackOff`, logs say `Authentication failed` | Wrong MongoDB credentials or wrong database case | Check username/password, make sure database is `Growthbook` (capital G), test with mongosh |
| Frontend crash, `pm2-runtime: no such file or directory` | Pulled the wrong image version | Make sure `image.tag` is set explicitly in values (don't rely on the chart default) |
| Backend stuck in `Pending` | No PVs available for the upload volume | Set `volumeClaim.enabled: false` |
| 502 on the external URL, pods `Running` | An alias Service has no endpoints (selector not matching), or an `ot` entry got reverted to ClusterIP + pinned Endpoints | Run `./deploy/deg-pp-rs/verify.sh` — it pinpoints which link is broken. Never fix this by pasting a pod IP into an `Endpoints` object |
| Frontend loads but shows "Failed to fetch" for API | `API_HOST` mismatch or CORS | Make sure `API_HOST` matches the external API URL exactly |

## What we'd change for production

- **Persistent uploads** — switch `UPLOAD_METHOD` to `s3` so uploaded files survive restarts
- **Resource limits** — GrowthBook docs recommend 2GB RAM and 1 vCPU minimum per pod, we have nothing set right now
- **Replicas** — running 1 of each, should be at least 3 for HA
- **Chart version pin** — `--version` is passed explicitly on upgrade, but nothing enforces it; the values file and the pinned chart version should live together
- **Email** — SMTP isn't configured. Invites still work: copy the invite URL from Settings → Members and send it yourself. Password reset email will not work until a company mail relay exists.
- **Service account** — `automount: true` by default, GrowthBook doesn't need K8s API access
