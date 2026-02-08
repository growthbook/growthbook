# Metadata in SDK Payloads - Implementation Plan

**PR Branch:** `bryce/metadata-in-sdk-payloads` (re-implementation)  
**Original PR:** #4877 `bryce/metadata-projects-in-sdk-payload`  
**Status:** Planning  
**Date:** 2025-02-07

---

## Overview

Re-implement metadata inclusion in SDK payloads using the new connection-specific cache system (`sdkConnectionCache`). This dramatically simplifies the original PR by eliminating the need for two-phase filtering (environment-level cache + JIT scrubbing).

### Key Simplification

| Original PR (Environment Cache)         | New Implementation (Connection Cache) |
| --------------------------------------- | ------------------------------------- |
| Generate with ALL metadata (union)      | Generate with ONLY requested metadata |
| Store intermediate `.project` field     | No temporary fields needed            |
| JIT filter metadata per-request         | Metadata pre-filtered in cache        |
| Complex two-phase filtering             | Single-phase generation               |
| Shared cache → per-connection filtering | Per-connection cache → no filtering   |

**Lines of code saved:** ~250 lines  
**Performance improvement:** No JIT filtering overhead per request

---

## Metadata Types

SDK connections can include three types of metadata in their payloads:

1. **Project Name** (`includeProjectName?: boolean`)
   - Single flag to include the project's `publicId` or `id` in feature/experiment metadata
   - Appears as `metadata.projects: ["proj-public-id"]`

2. **Custom Fields** (`includeCustomFields?: string[]`)
   - Array of custom field IDs to whitelist
   - Only specified custom fields appear in payload
   - Appears as `metadata.customFields: { "field-id": value }`

3. **Tags** (`includeTags?: string[]`)
   - Array of tag names to whitelist
   - Only specified tags appear in payload
   - Appears as `metadata.tags: ["tag1", "tag2"]`

---

## PR Review Comments to Address

From PR #4877 review by @jdorn and team:

### Critical Changes Required

1. **Rename `includeProjectName` → `includeProjectId`**
   - **Reason:** Projects have both names and IDs, but we're including the ID/publicId, not the name
   - **Files affected:** All schema files, types, models, controllers, frontend
   - **Priority:** HIGH (naming clarity)

2. **Change `includeTags` from array to boolean**
   - **Reason:** Array format suggests filtering (only features with tag A), not metadata inclusion
   - **Security concern:** Users might accidentally expose internal tags
   - **New design:** `includeTagsInPayload: boolean` - when true, includes ALL tags
   - **Note:** Can add filtering later if needed
   - **Files affected:** All schema files, types, models, controllers, frontend
   - **Priority:** HIGH (security + UX)

3. **Keep `includeCustomFields` as array**
   - **Reason:** Custom fields have more varied use cases (internal vs external fields)
   - **Granular control is valuable here**
   - **Priority:** N/A (keep as designed)

### Optional Improvements

4. **Remove accidental file:** `packages/front-end/services/importing/statsig/util.ts`
   - Added by mistake in original PR

5. **Project Model optimizations:**
   - `afterCreate` hook: Not needed (new projects have no features yet)
   - `afterDelete` hook: Optional (features deleted trigger refreshes anyway)
   - `afterUpdate` hook: Only trigger if `publicId` changes (not on every update)

6. **Auto-generate `publicId` from name if empty**
   - Add to `beforeCreate` hook in ProjectModel
   - Slugify project name → publicId if not provided
   - Reduces friction for users

7. **Consolidate identical code blocks**
   - In `SdkConnectionModel.ts` around line 93
   - Two identical blocks for legacy/new cache handling

8. **Future: Accept `publicId` in REST API querystrings**
   - Not for this PR, but document as future improvement
   - Allow filtering by project using public ID instead of internal ID

---

## Phase 1: Schema & Type Changes ✅

### Backend Types & Models

**IMPORTANT:** Based on PR review, use these field names:

- ✅ `includeProjectId?: boolean` (renamed from `includeProjectName`)
- ✅ `includeCustomFields?: string[]` (array for granular control)
- ✅ `includeTagsInPayload?: boolean` (renamed from `includeTags`, boolean not array)

- [ ] **`packages/shared/types/sdk-connection.d.ts`**
  - Update `SDKConnectionInterface`:
    ```typescript
    includeProjectId?: boolean;           // RENAMED from includeProjectName
    includeCustomFields?: string[];       // Array of field IDs
    includeTagsInPayload?: boolean;       // RENAMED from includeTags, BOOLEAN not array
    ```
  - Update `CreateSDKConnectionParams` and `EditSDKConnectionParams`

- [ ] **`packages/back-end/src/models/SdkConnectionModel.ts`**
  - Add fields to mongoose schema
  - Add to `createSDKConnectionValidator` (zod)
  - Add to `editSDKConnectionValidator` (zod)
  - Add to `toApiSDKConnectionInterface()` mapper
  - Add to `keysRequiringProxyUpdate` array (triggers cache refresh)
  - **TODO:** Consolidate identical code blocks around line 93 (from PR review)

- [ ] **`packages/back-end/src/api/sdk-connections/validations.ts`**
  - Add fields to `CreateSdkConnectionRequestBody` interface
  - Add default values in `validatePostPayload()`
  - Add fields to `validatePutPayload()`

### OpenAPI Schema

**Note:** Use correct field names from PR review:

- `includeProjectId` (boolean)
- `includeCustomFields` (array of strings)
- `includeTagsInPayload` (boolean)

- [ ] **`packages/back-end/src/api/openapi/schemas/SdkConnection.yaml`**
  - Add `includeProjectId` (boolean)
  - Add `includeCustomFields` (array of strings)
  - Add `includeTagsInPayload` (boolean)

- [ ] **`packages/back-end/src/api/openapi/payload-schemas/PostSdkConnectionPayload.yaml`**
  - Add new fields

- [ ] **`packages/back-end/src/api/openapi/payload-schemas/PutSdkConnectionPayload.yaml`**
  - Add new fields

- [ ] **`packages/back-end/src/validators/openapi.ts`**
  - Regenerate (run `yarn generate-openapi`)

- [ ] **`packages/back-end/types/openapi.d.ts`**
  - Regenerate (run `yarn generate-openapi`)

- [ ] **`packages/back-end/generated/spec.yaml`**
  - Regenerate (run `yarn generate-openapi`)

### SDK Types (Frontend)

- [ ] **`packages/sdk-js/src/types/growthbook.ts`**
  - Add `metadata?` field to `FeatureDefinition`:

    ```typescript
    export interface FeatureDefinition<T = any> {
      // ... existing fields ...
      metadata?: FeatureMetadata;
    }

    export interface FeatureMetadata {
      projects?: string[];
      customFields?: Record<string, unknown>;
      tags?: string[];
    }
    ```

- [ ] **`packages/sdk-js/src/index.ts`**
  - Export `FeatureMetadata` type

- [ ] **`packages/shared/types/sdk.d.ts`**
  - Add `metadata?` to `AutoExperiment`:

    ```typescript
    export interface AutoExperiment {
      // ... existing fields ...
      metadata?: ExperimentMetadata;
    }

    export interface ExperimentMetadata {
      projects?: string[];
      customFields?: Record<string, unknown>;
      tags?: string[];
    }
    ```

---

## Phase 2: Backend Core Changes 🔄

### Important Notes from Current Cache System

Before starting Phase 2, note that the current implementation (from previous work) already has:

- ✅ Unified `getFeatureDefinitionsWithCache()` helper in `controllers/features.ts`
- ✅ Cache-first strategy with JIT generation fallback
- ✅ Fire-and-forget cache writes on JIT generation with audit context
- ✅ Proper stack trace capture for audit logs
- ✅ Schema versioning support in `SdkConnectionCacheModel`

The metadata PR will build on this foundation!

### Update `SDKPayloadParams`

- [ ] **`packages/back-end/src/controllers/features.ts`**
  - Add new fields to `SDKPayloadParams` type:
    ```typescript
    export type SDKPayloadParams = Pick<
      SDKConnectionInterface,
      | /* ... existing fields ... */
      | "includeProjectName"
      | "includeCustomFields"
      | "includeTags"
    > & /* ... rest ... */;
    ```
  - Update `getPayloadParamsFromApiKey()`:
    - Extract metadata fields from SDK connection
    - Default to empty/false for legacy API keys

### Update Payload Generation

- [ ] **`packages/back-end/src/services/features.ts`**
  - Update `FeatureDefinitionArgs` interface:
    ```typescript
    includeProjectId?: boolean;          // RENAMED
    includeCustomFields?: string[];
    includeTagsInPayload?: boolean;      // RENAMED, BOOLEAN not array
    ```
  - Update `getFeatureDefinitions()`:
    - Accept new params
    - Pass through to payload generation helpers
  - Update `generateFeaturesPayload()`:
    - Accept metadata params
    - Build metadata object inline when generating each feature:

      ```typescript
      const metadata: FeatureMetadata = {};

      // Project ID (renamed from project name)
      if (includeProjectId && feature.project) {
        const project = projectsMap?.get(feature.project);
        if (project) {
          metadata.projects = [project.publicId || project.id];
        }
      }

      // Custom fields (filtered by whitelist)
      if (includeCustomFields?.length && feature.customFields) {
        const filtered: Record<string, unknown> = {};
        for (const fieldId of includeCustomFields) {
          if (feature.customFields[fieldId] !== undefined) {
            filtered[fieldId] = feature.customFields[fieldId];
          }
        }
        if (Object.keys(filtered).length > 0) {
          metadata.customFields = filtered;
        }
      }

      // Tags (ALL tags if enabled - no filtering)
      if (includeTagsInPayload && feature.tags?.length) {
        metadata.tags = feature.tags; // Include ALL tags
      }

      const def: FeatureDefinition = {
        ...featureDef,
        ...(Object.keys(metadata).length > 0 && { metadata }),
      };
      ```

    - **NO temporary `.project` field needed!**
  - Update `generateAutoExperimentsPayload()`:
    - Same metadata logic as features
  - **REMOVE** (no longer needed):
    - `getAllowedCustomFieldsForPayloads()` - was used for union computation
    - `getAllowedTagsForPayloads()` - was used for union computation
    - `shouldRefreshForMetadataChanges()` - handled in refresh triggers
    - JIT metadata filtering in `getFeatureDefinitionsResponse()` (lines that filter metadata)
    - Temporary `.project` field stripping logic

### Update Cache Refresh Triggers

- [ ] **`packages/back-end/src/models/SdkConnectionModel.ts`**
  - Already done: `keysRequiringProxyUpdate` includes metadata fields

- [ ] **Verify existing triggers work:**
  - Feature/Experiment `customFields` changes → `onFeatureUpdate()` → refresh ✅
  - Feature/Experiment `tags` changes → `onFeatureUpdate()` → refresh ✅
  - Feature/Experiment `project` changes → `onFeatureUpdate()` → refresh ✅

---

## Phase 3: Project Model Updates

### Project Schema Updates

- [ ] **`packages/shared/types/api.d.ts`**
  - Add `publicId?: string` to `Project` interface

- [ ] **`packages/back-end/src/models/ProjectModel.ts`**
  - Add `publicId` field to mongoose schema (optional string)
  - Add to validator (zod)
  - Add validation: `publicId` must be unique within organization
  - Add validation: `publicId` should be URL-safe (alphanumeric + hyphens/underscores)
  - **Add `beforeCreate` hook to auto-generate `publicId` from name if not provided:**
    ```typescript
    // In beforeCreate() hook
    if (!data.publicId && data.name) {
      data.publicId = slugify(data.name); // Convert "My Project" → "my-project"
    }
    ```
  - **Add after-update hook (ONLY if `publicId` changes):**
    ```typescript
    // In afterUpdate() - only trigger if publicId actually changed
    if (old.publicId !== newValue.publicId) {
      await queueSDKPayloadRefresh({
        context,
        payloadKeys: getPayloadKeysForAllEnvs(context, [project.id]),
        auditContext: {
          event: "project.update",
          model: "project",
          id: project.id,
        },
      });
    }
    ```
  - **Skip `afterCreate` hook** (not needed - new projects have no features yet)
  - **Skip `afterDelete` hook** (optional - features deleted already trigger refreshes)

- [ ] **`packages/back-end/src/api/projects/postProject.ts`**
  - Accept optional `publicId` in request body
  - Validate uniqueness on creation

- [ ] **`packages/back-end/src/api/openapi/schemas/Project.yaml`**
  - Add `publicId` field (optional string)
  - Add description: "Public identifier for this project, used in SDK payloads"

- [ ] **`packages/back-end/src/api/openapi/payload-schemas/PostProjectPayload.yaml`**
  - Add `publicId` field (optional)

- [ ] **`packages/back-end/src/api/openapi/payload-schemas/PutProjectPayload.yaml`** (if exists)
  - Add `publicId` field (optional)

---

## Phase 4: Custom Field & Tag Triggers ⚠️

### Custom Field Changes

**Important Context:**

- Tag deletion already scrubs values from features/experiments ✅
- Custom field deletion does NOT currently scrub values ❌ (needs fixing)
- Custom field definition changes (type, projects, enum values) do NOT trigger cache refresh ❌
- Custom field value changes on features/experiments DO trigger refresh via `onFeatureUpdate()` ✅

### Minimum Required (for this PR)

- [ ] **`packages/back-end/src/routers/custom-fields/custom-fields.controller.ts`**
  - **In `putCustomField()` (UPDATE):**
    ```typescript
    // After updating custom field definition
    await queueSDKPayloadRefresh({
      context,
      payloadKeys: getPayloadKeysForAllEnvs(context),
      auditContext: {
        event: "custom-field.update",
        model: "custom-field",
        id,
      },
    });
    ```
  - **In `deleteCustomField()` (DELETE):**
    - Option A (minimum): Just trigger cache refresh
    - Option B (better): Scrub values from features/experiments first, then refresh

    ```typescript
    // Before deleting definition
    await removeCustomFieldFromFeatures(context, id);
    await removeCustomFieldFromExperiments(context, id);

    // Delete definition
    await context.models.customFields.deleteCustomField(id);

    // Note: removeCustomFieldFromFeatures already calls onFeatureUpdate
    // which triggers refresh per-feature, so global refresh may be redundant
    ```

- [ ] **Optional: Add scrubbing helpers in `FeatureModel.ts`:**

  ```typescript
  export async function removeCustomFieldFromFeatures(
    context: ReqContext | ApiReqContext,
    fieldId: string,
  ) {
    const features = await FeatureModel.find({
      organization: context.org.id,
      [`customFields.${fieldId}`]: { $exists: true },
    });

    await FeatureModel.updateMany(
      { organization: context.org.id },
      { $unset: { [`customFields.${fieldId}`]: "" } },
    );

    // Trigger refresh for each feature
    features.forEach((feature) => {
      const oldInterface = toInterface(feature, context);
      const newInterface = {
        ...oldInterface,
        customFields: omit(oldInterface.customFields || {}, [fieldId]),
      };
      onFeatureUpdate(context, oldInterface, newInterface).catch(logger.error);
    });
  }
  ```

- [ ] **Optional: Similar for `ExperimentModel.ts`**

### Tag Changes

- [ ] **Verify tag deletion already works:**
  - `deleteTag()` → `removeTagInFeature()` → `onFeatureUpdate()` → refresh ✅
  - No changes needed!

---

## Phase 5: Frontend Changes

### SDK Connection Form

- [ ] **`packages/front-end/components/Features/SDKConnections/SDKConnectionForm.tsx`**
  - Add form fields:
    ```typescript
    includeProjectId: boolean;            // RENAMED
    includeCustomFields: string[];
    includeTagsInPayload: boolean;        // RENAMED, BOOLEAN not array
    ```
  - Add UI section "Metadata" with:
    - Checkbox: "Include project ID in metadata"
    - Multi-select: "Include custom fields" (fetch available custom fields from org)
    - Checkbox: "Include all tags in metadata" (boolean, not multi-select)
      - Help text: "When enabled, all feature tags will be included in the SDK payload"
  - Update form submission to include new fields

- [ ] **`packages/front-end/pages/setup/index.tsx`**
  - Add default values when creating SDK connection in setup flow:
    ```typescript
    includeProjectId: false,
    includeCustomFields: [],
    includeTagsInPayload: false,
    ```

### Vercel Integration (if applicable)

- [ ] **`packages/back-end/src/routers/vercel-native-integration/vercel-native-integration.controller.ts`**
  - Update `provisionResource()` to set default metadata values for Vercel-created connections:
    ```typescript
    includeProjectId: false,
    includeCustomFields: [],
    includeTagsInPayload: false,
    ```
  - Consider whether Vercel users should have different defaults

### Project Settings

- [ ] **`packages/front-end/components/Projects/ProjectModal.tsx`**
  - Add input field for `publicId`
  - Add validation (unique, alphanumeric + dashes)
  - Add help text explaining purpose (appears in SDK payloads)

- [ ] **`packages/front-end/pages/project/[pid].tsx`**
  - Display `publicId` in project details
  - Allow editing

- [ ] **`packages/front-end/pages/projects/index.tsx`**
  - Show `publicId` in projects list (optional column)

---

## Phase 6: Documentation

- [ ] **`packages/back-end/src/services/SDK_PAYLOAD_FLOW.md`**
  - Update flow diagram to reflect new simpler approach
  - Remove references to "union of SDK connection whitelists"
  - Remove references to intermediate `.project` fields
  - Update Step 3 to show metadata is generated per-connection
  - Simplify Step 7 (remove JIT metadata filtering section)
  - Add examples of metadata in payload

- [ ] **Update SDK documentation** (docs site)
  - Document `metadata` field in feature definitions
  - Document `metadata` field in experiments
  - Explain when/why to include metadata
  - Show examples of accessing metadata in SDKs

---

## Phase 7: Testing

### Unit Tests

- [ ] **`packages/back-end/test/api/sdk-connections.test.ts`**
  - Test creating SDK connection with metadata settings
  - Test updating metadata settings triggers cache refresh

- [ ] **`packages/back-end/test/services/features.test.ts` (NEW)**
  - Test metadata inclusion in feature payloads
  - Test `includeProjectId` includes project publicId (or falls back to id)
  - Test `includeCustomFields` filters correctly (only whitelisted fields)
  - Test `includeTagsInPayload` includes ALL tags (no filtering)
  - Test empty metadata is omitted
  - Test legacy API keys don't include metadata
  - Test auto-generated `publicId` on project creation

### Integration Tests

- [ ] Test full flow:
  1. Create SDK connection with metadata settings
  2. Create feature with custom fields, tags, project
  3. Fetch payload and verify metadata present
  4. Update SDK connection to disable metadata
  5. Verify metadata removed from payload

- [ ] Test project publicId:
  1. Create project without publicId - verify auto-generated from name
  2. Create project with publicId
  3. Assign feature to project
  4. Enable `includeProjectId` on SDK connection
  5. Verify payload includes `metadata.projects: ["publicId"]`
  6. Update project publicId
  7. Verify payload updated with new publicId

- [ ] Test cache refresh triggers:
  1. Change custom field definition
  2. Verify cache refreshed
  3. Change project publicId
  4. Verify cache refreshed

---

## Phase 8: Migration & Rollout

### Database Migration

- [ ] Add `publicId` field to existing projects (optional, null by default)
- [ ] Add metadata fields to existing SDK connections (default to false/empty arrays)
- [ ] No data migration needed - purely additive

### Feature Flag

- [ ] Consider gating with premium feature flag (optional)
- [ ] Or make available to all users

### Performance Considerations

- [ ] Verify cache refresh performance with large orgs
- [ ] Monitor payload size increase (metadata adds bytes)
- [ ] Consider adding `maxMetadataSize` limit if needed

### Cleanup

- [ ] **Remove accidentally added file:** `packages/front-end/services/importing/statsig/util.ts`
  - This file was added by mistake in the original PR

---

## Future Improvements (Separate PRs)

### Smart Custom Field Migration System

When custom field definitions change (type, projects, enum values), intelligently convert or scrub existing values.

- [ ] **Conversion Safety Matrix**
  - enum → string-like: safe (automatic conversion)
  - string → enum: conditional (keep if in enum list, scrub otherwise)
  - multiselect → string: safe (join with commas)
  - boolean → string: safe ("true"/"false")
  - number → string: safe (toString)
  - date/datetime conversions: safe
  - Others: scrub

- [ ] **Preview API:** `GET /custom-fields/:id/migration-preview`
  - Shows impact of proposed change
  - Counts affected entities
  - Calculates how many will convert vs scrub

- [ ] **Migration Execution:** `PUT /custom-fields/:id?confirmed=true`
  - Requires confirmation if data loss
  - Performs smart conversion
  - Scrubs incompatible values
  - Triggers cache refresh

- [ ] **Frontend Warning UI**
  - Show preview before applying change
  - Require checkbox confirmation for data loss
  - Display migration statistics

See detailed design in context window discussion.

### Future Enhancement: Accept `publicId` in REST API Filters

Currently, REST API endpoints accept `projectId` as a query parameter for filtering. In the future, these endpoints should accept either internal project IDs or public IDs interchangeably.

**Example:**

```
GET /api/v1/features?projectId=my-public-project-id
GET /api/v1/features?projectId=prj_abc123def456
```

**Implementation notes:**

- Look up project by `publicId` first, fall back to `id`
- Apply to all endpoints that filter by project
- Not required for this PR

---

## Checklist Summary

### Must Have (Blocker)

- [ ] Schema changes (SDK connection, project)
- [ ] Backend payload generation with metadata
- [ ] Frontend SDK connection form
- [ ] Cache refresh triggers (SDK connection settings)
- [ ] Basic tests

### Should Have (Important)

- [ ] Cache refresh on custom field changes
- [ ] Cache refresh on project publicId changes
- [ ] Custom field deletion scrubbing
- [ ] Project settings UI
- [ ] Documentation updates

### Nice to Have (Future)

- [ ] Smart custom field migration system
- [ ] Preview API for breaking changes
- [ ] Migration UI with warnings
- [ ] Performance optimizations

---

## Key Decisions

1. **Per-connection cache eliminates JIT filtering**
   - Major simplification from original PR
   - ~250 lines of code removed
   - Better performance (no filtering per request)

2. **Metadata fields are arrays for granular control**
   - `includeCustomFields: string[]` not `boolean`
   - `includeTags: string[]` not `boolean`
   - Allows fine-grained control over what's included

3. **Project publicId vs id**
   - Use `publicId` if set, fallback to `id`
   - Allows user-friendly identifiers in payloads

4. **Custom field migration in separate PR**
   - Too complex to block metadata feature
   - Valuable improvement on its own
   - Can be added later without breaking changes

5. **Always trigger cache refresh on metadata schema changes**
   - Simpler than conditional refresh logic
   - Performance impact negligible
   - Ensures payloads always up-to-date

---

## Questions / Decisions Needed

- [ ] Should metadata be premium feature or available to all?
- [ ] Should we limit payload size if metadata makes it too large?
- [ ] Should we implement custom field scrubbing in this PR or separate?
  - **Recommendation:** Separate PR (too complex to block metadata feature)
- [ ] Should we add telemetry/analytics for metadata usage?
- [ ] Validation for `publicId`: What format restrictions? (suggest: alphanumeric + hyphens/underscores)

---

## Recent Work Completed (Not Part of Metadata PR)

These items were completed in previous work and provide the foundation for the metadata PR:

✅ **New Connection-Specific Cache System (`sdkConnectionCache`)**

- Replaced environment-level cache with per-connection cache
- Each SDK connection gets its own cache entry
- Eliminates need for JIT filtering

✅ **Unified Cache Helper (`getFeatureDefinitionsWithCache`)**

- Consolidated cache-first logic into single helper
- Fire-and-forget cache writes with audit context
- Proper stack trace capture for debugging

✅ **Schema Versioning**

- `schemaVersion` field for emergency cache busting
- Compound index on `{id, schemaVersion}`
- Reuses `LATEST_SDK_PAYLOAD_SCHEMA_VERSION` constant

✅ **Legacy Cache Handling**

- Legacy API keys get synthetic cache keys: `legacy:{apiKey}:{env}:{project}`
- `deleteAllLegacyCacheEntries()` for bulk cleanup
- `formatLegacyCacheKey()` and `isLegacyCacheKey()` helpers

✅ **Efficient Upsert Operations**

- Native MongoDB `updateOne()` with `upsert: true`
- No pre-fetch required
- Atomic operations

---

## References

- Original PR: https://github.com/growthbook/growthbook/pull/4877
- Original branch: `bryce/metadata-projects-in-sdk-payload`
- New cache system docs: `packages/back-end/src/services/SDK_PAYLOAD_FLOW.md`
- Context window discussion: [Date: 2025-02-07]
