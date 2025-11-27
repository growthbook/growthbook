# SDK Payload Generation & Serving Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
                         1. CHANGE DETECTION

   Entrypoints:

   Feature Changes
   • back-end/src/models/FeatureModel.ts:onFeatureCreate()
   • back-end/src/models/FeatureModel.ts:onFeatureUpdate()
   • back-end/src/models/FeatureModel.ts:onFeatureDelete()

   Experiment Changes
   • back-end/src/models/ExperimentModel.ts:afterUpdate()

   Auto Experiment Changes
   • back-end/src/models/VisualChangesetModel.ts:afterUpdate()
   • back-end/src/models/UrlRedirectModel.ts:afterUpdate()

   Project Changes
   • back-end/src/models/ProjectModel.ts:afterCreate/afterUpdate/
     afterDelete()

   Safe Rollout Changes
   • back-end/src/models/SafeRolloutModel.ts:afterUpdate()

   Holdout Changes
   • back-end/src/routers/holdout/holdout.controller.ts:editStatus()
   • back-end/src/routers/holdout/holdout.controller.ts:deleteHoldout()
   Note: HoldoutModel doesn't use afterUpdate hooks; controller directly
   calls refreshSDKPayloadCache

   Saved Group Changes
   • back-end/src/services/savedGroups.ts:savedGroupUpdated()

   SDK Connection Changes
   • back-end/src/models/SdkConnectionModel.ts:editSDKConnection()
   • Changes to includeCustomFields or includeTags trigger cache refresh

   Model hooks detect changes and trigger cache refresh (non-blocking)
└─────────────────────────────────────────────────────────────────────────┘

                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
                    2. CALCULATE AFFECTED PAYLOADS

   Payload Key: {environment, project}
   • Identifies which cached payloads need regeneration
   • Used to determine which environments to refresh
   • Project field indicates which projects are affected (useful for
     webhooks/notifications), but cache lookup uses only {organization,
     environment, schemaVersion} - cache is per-environment, not per-project
   • Prevents unnecessary regeneration of unaffected payloads

   Each entrypoint calculates payload keys based on what changed:

   Most model changes (Features, Safe Rollouts, Holdouts):
   • getAffectedSDKPayloadKeys([entity], environments)
   • Calculates keys for specific environments where entity is active

   Environment-less changes (Projects, Saved Groups):
   • getPayloadKeysForAllEnvs(context, [projectIds])
   • Calculates keys for ALL environments (affects all envs equally)

   Experiment Changes:
   • getPayloadKeys(context, experiment, linkedFeatures)
   • Uses getAffectedSDKPayloadKeys for feature flag experiments
   • Uses getPayloadKeysForAllEnvs for visual/URL redirect experiments

   All return: [{environment, project}, ...]
   • One key per (project × environment) combination
   • Keys identify which environments need regeneration (project info used
     for tracking, but cache is per-environment, not per-project)
└─────────────────────────────────────────────────────────────────────────┘

                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
                    3. REGENERATE CACHED PAYLOADS

   Entrypoint:
   • back-end/src/services/features.ts:refreshSDKPayloadCache(payloadKeys)

   Process:
   • Filters payloadKeys to only valid environments
   • Extracts unique environments from payloadKeys (ignores project part)
   • For each affected environment (one cache entry per environment):

     Data Loading:
     • getAllFeatures() - all features in org
     • getAllPayloadExperiments() - all experiments
     • getAllPayloadSafeRollouts() - all safe rollouts
     • getAllVisualExperiments() - visual editor experiments
     • getAllURLRedirectExperiments() - URL redirect experiments
     • getAllPayloadHoldouts() - all holdouts
     • getSavedGroupMap() - all saved groups
     • findSDKConnectionsByOrganization() - used to union all custom fields
       and tags whitelisted across all SDK Connections' settings

     Payload Generation:
     • generateFeaturesPayload() - creates feature definitions with
       temporary `.project` field and metadata (projects, customFields, tags
       - limited to SDK connection union)
     • generateAutoExperimentsPayload() - creates experiment definitions
       with temporary `.project` field and metadata (projects, customFields,
       tags - limited to SDK connection union)
     • generateHoldoutsPayload() - creates holdout definitions
     • filterUsedSavedGroups() - identifies which saved groups are used

     Cache Storage:
     • back-end/src/models/SdkPayloadModel.ts:updateSDKPayload()
     • MongoDB lookup key: {organization, environment, schemaVersion}
       (NOT {organization, environment, project} - cache is per-environment!)
     • Contents stored as JSON string (handles invalid Mongo field keys)

   Note: schemaVersion is an emergency cachebuster (currently 1) that's
   basically never used.

   Intermediate data stored in cache:
   • FeatureDefinitionWithProject: includes temporary `project?: string`
     field (project ID) and metadata (projects, customFields, tags - union
     of SDK connection whitelists)
   • AutoExperimentWithProject: includes temporary `project?: string`
     field (project ID) and metadata (projects, customFields, tags - union
     of SDK connection whitelists)
   • The `.project` field is used for filtering in step 7, then stripped
   • `metadata.projects`, `metadata.customFields`, and `metadata.tags` are
     precomputed here and filtered per-request in step 7

   Note: Payload keys are NOT used as MongoDB lookup keys. They're used to
   determine which environments to regenerate. Cache contains ALL projects
   for that environment in a single entry.
└─────────────────────────────────────────────────────────────────────────┘

                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
                      4. USER REQUEST (SDK Key)

   Entrypoint: back-end/src/services/features.ts:getFeatureDefinitions()

   Primary Entrypoint:
   • GET /api/features/:key
     - back-end/src/controllers/features.ts:getFeaturesPublic()
     - Standard SDK payload endpoint

   Other API Routes:
   • GET /api/v1/sdk-payload/:key
     - back-end/src/api/sdk-payload/getSdkPayload.ts:getSdkPayload()
     - Remote eval hydration endpoint

   • POST /api/eval/:key (self-hosted only)
     - back-end/src/controllers/features.ts:getEvaluatedFeaturesPublic()
     - Remote eval endpoint

   Webhooks:
   • SDK webhooks
     - back-end/src/jobs/sdkWebhooks.ts:fireSdkWebhook()
     - back-end/src/jobs/sdkWebhooks.ts:getSDKConnectionsByPayloadKeys()
   • Proxy update
     - back-end/src/jobs/proxyUpdate.ts
   • Legacy webhooks
     - back-end/src/jobs/webhooks.ts (webhook job)
└─────────────────────────────────────────────────────────────────────────┘

                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
                    5. LOOKUP SDK CONNECTION

   Entrypoint:
   • back-end/src/controllers/features.ts:getPayloadParamsFromApiKey()

   Finds SDK connection by key (sdk-xxx) and extracts:
   • environment, projects, capabilities, encryptionKey, and all payload
     modifier flags (includeVisualExperiments, includeDraftExperiments,
     includeExperimentNames, includeRedirectExperiments, includeRuleIds,
     includeProjectPublicId, includeCustomFields, includeTags,
     hashSecureAttributes, savedGroupReferencesEnabled)
└─────────────────────────────────────────────────────────────────────────┘

                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
                    6. RETRIEVE CACHED PAYLOAD

   Entrypoint:
   • back-end/src/services/features.ts:getFeatureDefinitions()

   MongoDB Fetch
   • back-end/src/models/SdkPayloadModel.ts:getSDKPayload()
   • Query: {organization, environment, schemaVersion}

   Returns cached payload with intermediate `.project` field and metadata
   (pre-filtered union):
   • features: Record<string, FeatureDefinitionWithProject>
   • experiments: AutoExperimentWithProject[]
   • savedGroupsInUse: string[]
   • holdouts: Record<string, FeatureDefinitionWithProjects>
   • Metadata includes `metadata.projects`, `metadata.customFields`, and
     `metadata.tags` (union of all SDK connection whitelists)
└─────────────────────────────────────────────────────────────────────────┘

                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
                      7. JIT SCRUBBING/FILTERING

   Entrypoint:
   • back-end/src/services/features.ts:getFeatureDefinitionsResponse()

   Inline Filtering & Transformation (in order):
   • Filter draft experiments (if !includeDraftExperiments)
   • Remove experiment/rule names (if !includeExperimentNames)
   • Filter by projects using `.project` field from cached payload
   • Transform metadata:
     - Remove `metadata.projects` if !includeProjectPublicId (values already
       populated in step 3)
     - Remove empty `metadata.projects` arrays even if includeProjectPublicId
       is true
     - If includeCustomFields is provided and non-empty, filter existing
       `metadata.customFields` down to that whitelist; otherwise remove
     - Remove empty `metadata.customFields` objects
     - If includeTags is provided and non-empty, filter existing
       `metadata.tags` down to that whitelist; otherwise remove
     - Remove empty `metadata.tags` arrays
     - Remove `metadata` object entirely if all fields are empty/removed
   • Strip temporary `.project` field

   • Scrub holdouts and merge into features
     - shared/src/sdk-versioning/sdk-payload.ts:scrubHoldouts()

   • Secure attribute hashing (if hashSecureAttributes enabled)
     - back-end/src/services/features.ts:applyFeatureHashing()
     - back-end/src/services/features.ts:applyExperimentHashing()
     - back-end/src/services/features.ts:applySavedGroupHashing()

   • Capability-based scrubbing
     - shared/src/sdk-versioning/sdk-payload.ts:scrubFeatures()
     - shared/src/sdk-versioning/sdk-payload.ts:scrubExperiments()
     - shared/src/sdk-versioning/sdk-payload.ts:scrubSavedGroups()

   • Filter experiment types (redirect/visual) per settings
     - back-end/src/services/features.ts:getFeatureDefinitionsResponse()

   • Remove rule IDs (if !includeRuleIds)
     - back-end/src/services/features.ts:getFeatureDefinitionsResponse()

   Encryption
   • encrypt() (if encryptionKey provided)
     - back-end/src/services/features.ts:encrypt()

   Note: All connections for same environment share cache, but get
   different scrubbed versions based on their settings
└─────────────────────────────────────────────────────────────────────────┘

                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
                         8. RETURN PAYLOAD

   Returns from:
   • back-end/src/api/sdk-payload/getSdkPayload.ts:getSdkPayload()

   Response:
   {
     features: {...} | {},
     experiments: [...] | [],
     dateUpdated: Date,
     savedGroups: {...},
     encryptedFeatures?: string,  // If encryption enabled
     encryptedExperiments?: string,
     encryptedSavedGroups?: string
   }
└─────────────────────────────────────────────────────────────────────────┘
```
