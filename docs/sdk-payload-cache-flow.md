# SDK Payload Cache & Serve Flow

**Bulk path:** `payloadKeys` = scope only (`{ environment, project }[]`). We don't know connection cache keys at queue time. Refresh discovers them: load all connections (each has `connection.key`), filter to affected, then build + upsert per connection. **Delete legacy** = clear legacy API cache entries (not connection-keyed).

```mermaid
flowchart TB
  subgraph EVENT["Event-based triggers"]
    DEFS["Definitions: features, experiments, holdouts, rollouts, envs/projects, saved groups"]
    CONN["SDK connection create/update"]
    ENV["Environment (projects) update"]
    Q_BULK["queueSDKPayloadRefresh(payloadKeys) — bulk"]
    Q_SINGLE["queueSDKPayloadRefresh(sdkConnections) — single connection"]
    Q_TARGETED["queueSDKPayloadRefresh(sdkConnections) — targeted connections"]
  end

  subgraph REFRESH["refreshSDKPayloadCache"]
    R_CLEAR["deleteAllLegacyCacheEntries()"]
    R_LOAD["load org data, rawData, holdoutsMap"]
    R_BULK["findSDKConnectionsByOrganization()"]
    R_FILTER["filter to affected (isSDKConnectionAffectedByPayloadKey)"]
    R_PASSED["use sdkConnectionsToUpdate (passed list)"]
    R_LOOP["per connection: buildSDKPayloadForConnection → sdkConnectionCache.upsert(key)"]
    R_WH["triggerWebhookJobs()"]
    R_JOBS["queueWebhooksByConnections, queueLegacySdkWebhooks, queueProxyUpdate, purgeCDNCache"]
  end

  subgraph GET["GET (cache miss → regen)"]
    G_API["GET /api/features/:key"]
    G_REST["GET /api/v1/sdk-payload/:key"]
    G_LEGACY["Legacy public (same URL, legacy key)"]
    RESOLVE["getPayloadParamsFromApiKey (findSDKConnectionByKey / formatLegacyCacheKey)"]
  end

  subgraph AGENDA["Agenda jobs (cache miss → regen)"]
    J_LEGACY["Legacy webhook job (fireWebhook)"]
    J_SDK["SDK webhook job (fireWebhooks)"]
    J_PROXY["Proxy update job (queueProxyUpdate)"]
  end

  subgraph CACHE["getFeatureDefinitionsWithCache"]
    GET_TRY["sdkConnectionCache.getById(params.key)"]
    HIT["hit → return"]
    MISS["miss → getFeatureDefinitions → buildSDKPayloadForConnection → sdkConnectionCache.upsert → return"]
  end

  DEFS --> Q_BULK
  CONN --> Q_SINGLE
  ENV --> Q_TARGETED
  Q_BULK --> R_CLEAR
  Q_SINGLE --> R_CLEAR
  Q_TARGETED --> R_CLEAR
  R_CLEAR --> R_LOAD
  R_LOAD --> R_BULK
  R_LOAD --> R_PASSED
  R_BULK --> R_FILTER
  R_FILTER --> R_LOOP
  R_PASSED --> R_LOOP
  R_LOOP --> R_WH
  R_WH --> R_JOBS

  G_API --> RESOLVE
  G_REST --> RESOLVE
  G_LEGACY --> RESOLVE
  RESOLVE --> GET_TRY

  J_LEGACY --> GET_TRY
  J_SDK --> GET_TRY
  J_PROXY --> GET_TRY

  GET_TRY --> HIT
  GET_TRY --> MISS
```

## Verified against main (current code paths)

| Flow | Code location | Status |
|------|---------------|--------|
| **Event triggers → queueSDKPayloadRefresh** | FeatureModel, ExperimentModel, SafeRolloutModel, savedGroups, holdout.controller, updateHoldoutStatus, VisualChangesetModel, UrlRedirectModel → `payloadKeys`. SdkConnectionModel, sdk-connection.controller → `sdkConnections: [connection]`. environment.controller, putEnvironment → `sdkConnections: affectedConnections`. | ✓ Matches |
| **refreshSDKPayloadCache** | features.ts:562–753. deleteAllLegacyCacheEntries → load rawData (features, experimentMap, groupMap, safeRolloutMap, savedGroups, visual/redirect) → holdoutsMapByEnv per env → sdkConnections = payloadKeys.length ? findSDKConnectionsByOrganization : sdkConnectionsToUpdate → forEach: filter (bulk) or use list, buildSDKPayloadForConnection → upsert → promiseAllChunks → triggerWebhookJobs. | ✓ Matches |
| **triggerWebhookJobs** | updateAllJobs.ts:17–56. queueWebhooksByConnections, fireGlobalSdkWebhooks, queueProxyUpdate (if enabled), queueLegacySdkWebhooks, purgeCDNCache. | ✓ Matches |
| **GET /api/features/:key** | controllers/features.ts getFeaturesPublic: getPayloadParamsFromApiKey(key) → getFeatureDefinitionsWithCache(context, params). | ✓ Matches |
| **GET /api/v1/sdk-payload/:key** | api/sdk-payload/getSdkPayload.ts: getPayloadParamsFromApiKey(key) → getFeatureDefinitionsWithCache. | ✓ Matches |
| **getPayloadParamsFromApiKey** | controllers/features.ts:182–266. sdk-* → findSDKConnectionByKey → connection params. Else legacy → lookupOrganizationByApiKey, formatLegacyCacheKey → legacy params (languages: ["legacy"]). | ✓ Matches |
| **getFeatureDefinitionsWithCache** | controllers/features.ts:272–353. getById(params.key) → hit: return parsed; miss: getFeatureDefinitions(...) → upsert (fire-and-forget) → return defs. | ✓ Matches |
| **Legacy webhook job** | webhooks.ts: fireWebhook uses formatLegacyCacheKey(webhook_${id}, env, project), getFeatureDefinitionsWithCache with legacy params. | ✓ Matches |
| **SDK webhook job** | sdkWebhooks.ts: getFeatureDefinitionsWithCache(context, params: connection) per connection. | ✓ Matches |
| **Proxy update job** | proxyUpdate.ts: getFeatureDefinitionsWithCache(context, params: connection). | ✓ Matches |

No regressions: all paths match the flowchart. Bulk and targeted both use one shared rawData load; connection list is either findSDKConnectionsByOrganization (bulk) or sdkConnectionsToUpdate (targeted).
