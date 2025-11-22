# Multi-Environment Rules - Action Plan

## Overview

Refactor feature rules to support multi-environment tagging instead of duplicating rules per environment.

## Before & After: Feature Interface Structure

### Before (Legacy Format)

```typescript
interface FeatureInterface {
  id: string;
  // ... other fields ...

  environmentSettings: Record<
    string,
    {
      enabled: boolean;
      rules: FeatureRule[]; // Rules nested per environment
    }
  >;

  // No top-level rules array
}
```

**Example:**

```typescript
{
  id: "my-feature",
  environmentSettings: {
    "dev": {
      enabled: true,
      rules: [
        { type: "force", value: "true", condition: "..." },
        { type: "rollout", value: "false", coverage: 0.5, ... }
      ]
    },
    "prod": {
      enabled: true,
      rules: [
        { type: "force", value: "true", condition: "..." },  // Duplicate rule
        { type: "rollout", value: "false", coverage: 0.5, ... }  // Duplicate rule
      ]
    }
  }
}
```

### After (Modern Format)

```typescript
interface FeatureInterface {
  id: string;
  // ... other fields ...

  environmentSettings: Record<
    string,
    {
      enabled: boolean; // Only kill switch, no rules
    }
  >;

  rules: Array<
    FeatureRule & {
      uid: string; // Unique identifier
      allEnvironments: boolean; // Applies to all environments
      environments: string[]; // Specific environment IDs
    }
  >;
}
```

**Example:**

```typescript
{
  id: "my-feature",
  environmentSettings: {
    "dev": { enabled: true },
    "prod": { enabled: true }
  },
  rules: [
    {
      uid: "rule-1-uuid",
      type: "force",
      value: "true",
      condition: "...",
      environments: ["dev"],           // Tagged to dev
      allEnvironments: false
    },
    {
      uid: "rule-2-uuid",
      type: "rollout",
      value: "false",
      coverage: 0.5,
      environments: ["dev"],           // Tagged to dev
      allEnvironments: false
    },
    {
      uid: "rule-3-uuid",
      type: "force",
      value: "true",
      condition: "...",
      environments: ["prod"],          // Tagged to prod (separate instance)
      allEnvironments: false
    },
    {
      uid: "rule-4-uuid",
      type: "rollout",
      value: "false",
      coverage: 0.5,
      environments: ["prod"],          // Tagged to prod (separate instance)
      allEnvironments: false
    }
  ]
}
```

**Key Changes:**

- Rules moved from `environmentSettings[env].rules[]` to top-level `rules[]`
- Each rule has `uid` (UUID v4) for unique identification
- Each rule has `environments: string[]` to tag which environments it applies to
- Each rule has `allEnvironments: boolean` flag (if true, applies to all environments)
- Rules are NOT deduplicated - identical rules in different environments become separate rule instances
- `environmentSettings[env]` now only contains `enabled: boolean` (kill switch)

---

## Checklist

### ✅ Phase 1: Schema & Types - COMPLETE

- [x] Legacy validators (`legacyFeatureRule`, `legacyFeatureInterface`)
- [x] Modern validators with `uid`, `environments`, `allEnvironments`
- [x] TypeScript types updated

**Files:** `packages/back-end/src/validators/features.ts`, `packages/back-end/types/feature.ts`

---

### ⚠️ Phase 2: JIT Migration - PARTIALLY COMPLETE

#### 2.1 Migration Functions

- [x] `upgradeFeatureInterface()` - converts legacy → modern format
- [x] `upgradeRevisionRules()` - converts legacy revision rules → modern
- [ ] **REQUIRED:** `downgradeFeatureInterface()` - converts modern → legacy for REST API v1
- [ ] **REQUIRED:** `downgradeFeatureRevision()` - converts modern revision → legacy for REST API v1

**Details:**

- `downgradeFeatureInterface()` should:
  - Distribute `feature.rules[]` back into `environmentSettings[env].rules[]`
  - Remove `uid`, `environments`, `allEnvironments` from each rule
  - Handle `allEnvironments: true` rules (distribute to all envs)

**Files:** `packages/back-end/src/util/migrations.ts`

#### 2.2 Mongoose Schemas - COMPLETE

- [x] FeatureModel supports both formats
- [x] FeatureRevisionModel supports both formats
- [x] `toInterface()` calls `upgradeFeatureInterface()`

**Files:** `packages/back-end/src/models/FeatureModel.ts`, `packages/back-end/src/models/FeatureRevisionModel.ts`

---

### ✅ Phase 3: Backend Services - COMPLETE

- [x] `getApiFeatureObj()` works with modern format
- [x] SDK payload generation works (format unchanged)
- [x] `addFeatureRule()` creates rules with `uid`, `environments`, `allEnvironments`
- [x] `editFeatureRule()` finds rules by UID
- [x] `copyFeatureEnvironmentRules()` copies rules to new environments

**Note:** Helper methods like `getRuleByUid()`, `updateRuleByUid()`, etc. are **NOT needed** - existing methods are sufficient.

**Files:** `packages/back-end/src/services/features.ts`, `packages/back-end/src/models/FeatureModel.ts`

---

### ⚠️ Phase 3.5: SDK Payload & Cache Verification - REQUIRED

**Critical:** Verify SDK payload generation and caching remain unaffected by the migration.

#### 3.5.1 SDK Payload Format Verification

- [ ] Verify `getApiFeatureObj()` produces identical payload format before/after migration
- [ ] Verify `generateFeaturesPayload()` correctly filters rules by environment
- [ ] Test that SDK clients receive identical payload structure (no breaking changes)
- [ ] Verify rules in payload don't include `uid`, `environments`, `allEnvironments` fields (these are internal only)

**Test Cases:**

- Feature with rules in single environment
- Feature with rules in multiple environments
- Feature with `allEnvironments: true` rules
- Feature with no rules
- Feature with rules filtered by project

**Files:** `packages/back-end/src/services/features.ts` (specifically `getApiFeatureObj()`, `generateFeaturesPayload()`)

#### 3.5.2 Cache Key Verification

- [ ] Verify cache keys remain `{ organization, environment }` (unchanged)
- [ ] Verify cache keys don't include rule-specific data (should only be org + env)
- [ ] Test cache lookup by organization + environment still works correctly

**Details:**

- Cache is keyed by `organization` + `environment` in `SdkPayloadModel`
- Cache should NOT be keyed by rule UIDs or rule structure
- Verify `getSDKPayload({ organization, environment })` works correctly

**Files:** `packages/back-end/src/models/SdkPayloadModel.ts`, `packages/back-end/src/services/features.ts` (`getFeatureDefinitions()`)

#### 3.5.3 Cache Invalidation Verification

- [ ] Verify cache invalidation triggers when feature rules change
- [ ] Verify cache invalidation triggers when feature is created/updated/deleted
- [ ] Verify cache invalidation triggers when environment settings change
- [ ] Verify cache invalidation triggers when experiments change (if linked to features)
- [ ] Verify cache invalidation triggers when SDK connection settings change
- [ ] Verify cache invalidation triggers when environment is created/deleted
- [ ] Verify `refreshSDKPayloadCache()` correctly generates new payloads with modern rule format

**Test Cases:**

- Add rule to feature → cache invalidates for affected environment
- Edit rule in feature → cache invalidates for affected environment
- Delete rule from feature → cache invalidates for affected environment
- Change feature's `environmentSettings[env].enabled` → cache invalidates
- Add/remove environment → cache invalidates appropriately
- Change SDK connection project filter → cache invalidates

**Details:**

- `refreshSDKPayloadCache()` takes `payloadKeys: SDKPayloadKey[]` with `{ environment, project }`
- Verify payload keys are correctly calculated when rules change
- Verify `generateFeaturesPayload()` filters rules correctly per environment

**Files:**

- `packages/back-end/src/services/features.ts` (`refreshSDKPayloadCache()`, `generateFeaturesPayload()`)
- `packages/back-end/src/controllers/features.ts` (where cache invalidation is triggered)
- `packages/back-end/src/models/FeatureModel.ts` (where feature changes trigger invalidation)

---

### ⚠️ Phase 4: REST API - PARTIALLY COMPLETE

**Dependencies:** Phase 3.5 (SDK Payload & Cache Verification)

#### 4.1 REST API v1 (Legacy Format) - REQUIRED

- [ ] Update all v1 endpoints to call `downgradeFeatureInterface()` before returning:
  - `GET /v1/features/:id` → `getFeature.ts`
  - `GET /v1/features` → `listFeatures.ts`
  - `POST /v1/features` → `postFeature.ts` (accept legacy, convert to modern internally)
  - `PUT /v1/features/:id` → `updateFeature.ts` (accept legacy, convert to modern internally)
- [ ] Update revision endpoints to call `downgradeFeatureRevision()`:
  - `GET /v1/features/:id/revisions` → `getFeatureRevisions.ts`

**Details:**

- v1 endpoints should accept and return legacy format
- Convert incoming legacy format to modern internally
- Convert outgoing modern format to legacy before returning

**Files:** `packages/back-end/src/api/features/*.ts`

#### 4.2 REST API v2 (Modern Format) - OPTIONAL

- [ ] Add v2 routes in `features.router.ts`:
  - `GET /v2/features/:id` - returns modern format (no downgrade)
  - `POST /v2/features` - accepts modern format
  - `PUT /v2/features/:id` - accepts modern format
- [ ] Add UID-based endpoints (optional):
  - `PUT /v2/features/:id/rules/:uid` - find rule by UID, call `editFeatureRule`
  - `DELETE /v2/features/:id/rules/:uid` - find rule by UID, call `deleteFeatureRule`
- [ ] Update OpenAPI spec with v2 routes

**Note:** v2 is optional - v1 with downgrade provides backward compatibility.

**Files:** `packages/back-end/src/api/features/features.router.ts`, `packages/back-end/generated/spec.yaml`

---

### ✅ Phase 5: Frontend Services - COMPLETE

- [x] `getRules(feature, envId)` filters by environment
- [ ] API client methods for v2 endpoints (only if v2 is implemented)

**Files:** `packages/front-end/services/features.ts`

---

### ✅ Phase 6: UI Components - MOSTLY COMPLETE

#### 6.1 Core Components - COMPLETE

- [x] `Rule.tsx` - environment badges
- [x] `RuleList.tsx` - inline filtering, drag-and-drop with UIDs
- [x] `FeatureRules.tsx` - filtered rules per environment tab

**Files:** `packages/front-end/components/Features/Rule.tsx`, `RuleList.tsx`, `FeatureRules.tsx`

#### 6.2 Rule Modal - MOSTLY COMPLETE

- [x] Environment multi-selector in create mode
- [ ] Allow editing environments in **edit mode** (currently only create mode)

**Files:** `packages/front-end/components/Features/RuleModal/index.tsx`

#### 6.3 Add Experiment to Feature Flag - VERIFICATION REQUIRED

- [ ] Verify `FeatureFromExperimentModal` correctly sets rule environments when adding experiment to feature
- [ ] Verify rule is created with `environments` array populated from selected environment settings
- [ ] Verify rule is created with `uid` and `allEnvironments: false`
- [ ] Test adding experiment to new feature flag
- [ ] Test adding experiment to existing feature flag
- [ ] Verify rule appears in correct environment tabs after creation

**Details:**

- `FeatureFromExperimentModal` creates `ExperimentRefRule` with `uid`, `environments`, `allEnvironments`
- Rule should be tagged to environments where `environmentSettings[env].enabled === true`
- Rule should NOT have `environments: []` - must be populated from form selections

**Files:** `packages/front-end/components/Features/FeatureModal/FeatureFromExperimentModal.tsx`

---

### ⚠️ Phase 7: Reordering Modal - OPTIONAL

- [ ] Create `ReorderRulesModal.tsx`:
  - Show all rules with environment badges
  - Drag-and-drop to reorder
  - Save via existing reorder API
- [ ] Add "Reorder Rules" button

**Note:** Reordering already works globally in `RuleList.tsx` - this is a UX improvement.

**Files:** `packages/front-end/components/Features/ReorderRulesModal.tsx` (new)

---

### ⚠️ Phase 8: Testing - NOT STARTED

- [ ] Unit tests for `downgradeFeatureInterface()` and `downgradeFeatureRevision()`
- [ ] Test REST API v1 returns legacy format
- [ ] Test REST API v2 returns modern format (if implemented)
- [ ] Test permission validation for multi-env rules
- [ ] Integration tests for rule operations

**Files:** `packages/back-end/test/util/migrations.test.ts`, `packages/back-end/test/api/features/*.test.ts`

---

## Summary

**Progress:** ~85% complete

**Required (Blocking):**

1. Implement `downgradeFeatureInterface()` and `downgradeFeatureRevision()`
2. **Verify SDK payload generation and caching (Phase 3.5)** - CRITICAL
3. Update REST API v1 endpoints to use downgrade functions

**Optional (Nice to Have):**

1. REST API v2 routes
2. Environment editing in RuleModal edit mode
3. ReorderRulesModal component
4. Comprehensive test coverage

**What's NOT Needed:**

- Helper methods like `getRuleByUid()`, `updateRuleByUid()`, `addRuleToEnvironments()`, etc.
- `getRuleEnvironments()` helper - just use `rule.environments` directly
- Separate UID-based endpoint handlers - find rules inline and use existing methods

---

## Technical Notes

### Migration Algorithm

```typescript
// Upgrade: legacy → modern
for (const [envId, envSettings] of Object.entries(legacy.environmentSettings)) {
  envSettings.rules.forEach((legacyRule) => {
    rules.push({
      ...legacyRule,
      uid: uuidv4(),
      environments: [envId],
      allEnvironments: false,
    });
  });
}

// Downgrade: modern → legacy (REQUIRED)
for (const rule of feature.rules) {
  const targetEnvs = rule.allEnvironments
    ? Object.keys(feature.environmentSettings)
    : rule.environments;

  targetEnvs.forEach((envId) => {
    const { uid, environments, allEnvironments, ...legacyRule } = rule;
    environmentSettings[envId].rules.push(legacyRule);
  });
}
```

### Key Decisions

1. **UID Format:** UUID v4
2. **Deduping:** NO - migration creates separate rule instances per environment
3. **Migration:** JIT in `upgradeFeatureInterface()` - no DB migration needed
4. **API Versioning:** v1 (legacy) and v2 (modern) both permanent
5. **Permissions:** Must have ALL environments' permissions to modify multi-env rule

### Edge Cases

1. **Environment Deletion:** Remove env from `rule.environments`, delete rule if empty
2. **Permission Boundaries:** Cannot modify rule unless have permission for ALL its environments
3. **Identical Rules:** Migration creates duplicates intentionally (allows independent modification)
4. **SDK Payload:** Format must stay identical - filter rules by environment during payload generation
