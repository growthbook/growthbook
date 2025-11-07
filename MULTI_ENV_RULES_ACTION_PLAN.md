# Multi-Environment Rules - Action Plan

## Overview

This project refactors the feature rule system to support rules tagged with multiple environments rather than duplicating rules within environment-specific objects.

**Current Structure:**
```typescript
interface FeatureInterface {
  environmentSettings: Record<string, {
    enabled: boolean;
    rules: FeatureRule[]
  }>;
}
```

**New Structure:**
```typescript
interface FeatureInterface {
  environmentSettings: Record<string, {
    enabled: boolean; // environment-level kill switch only
  }>;
  
  rules: Array<FeatureRule & {
    uid: string;
    allEnvironments: boolean;
    environments: string[];
  }>;
}
```

---

## Phase 1: Define New Schema and Types

### 1.1 Update Validators in `packages/back-end/src/validators/features.ts`

**Tasks:**
- [ ] Rename current `featureRule` to `legacyFeatureRule`
- [ ] Rename current `featureInterface` to `legacyFeatureInterface`
- [ ] Create new `featureRule` validator extending `legacyFeatureRule` with:
  - `uid: z.string()` - Unique identifier for the rule
  - `allEnvironments: z.boolean()` - Whether rule applies to all environments
  - `environments: z.array(z.string())` - Array of environment IDs
- [ ] Create new `featureInterface` with:
  - `environmentSettings: z.record(z.string(), z.object({ enabled: z.boolean() }).strict())`
  - `rules: z.array(featureRule)` - Required array (can be empty)
- [ ] Export both legacy and modern interfaces

**Files to modify:**
- `packages/back-end/src/validators/features.ts`
- `packages/back-end/types/feature.ts` (TypeScript types)

**Dependencies:** None

---

## Phase 2: Implement JIT Migration

### 2.1 Update Migration Utilities in `packages/back-end/src/util/migrations.ts`

**Tasks:**
- [ ] Implement `generateRuleUid()` helper using `uuidv4()`
- [ ] Update `upgradeFeatureInterface()` to migrate legacy to modern format:
  - Merge all environment rules into single array
  - Generate unique UIDs for each rule instance
  - Tag each rule with source environment
  - **DO NOT dedupe** - create separate entries even for identical rules across environments
  - Preserve rule ordering per environment
- [ ] Implement `downgradeFeatureInterface()` for REST API v1:
  - Convert modern format back to legacy format
  - Distribute rules back to environment-specific arrays based on `environments` field
- [ ] Apply same migration to revisions in `upgradeFeatureRevision()`
- [ ] Implement `downgradeFeatureRevision()` for REST API v1

**Key Algorithm:**
```typescript
function upgradeFeatureInterface(legacy: LegacyFeatureInterface): FeatureInterface {
  const rules: FeatureRule[] = [];
  
  // Process each environment's rules - NO DEDUPING
  for (const [envId, envSettings] of Object.entries(legacy.environmentSettings)) {
    envSettings.rules.forEach((legacyRule) => {
      rules.push({
        ...legacyRule,
        uid: generateRuleUid(), // Random, unique
        environments: [envId],
        allEnvironments: false
      });
    });
  }
  
  return {
    ...legacy,
    environmentSettings: stripRulesFromEnvSettings(legacy.environmentSettings),
    rules
  };
}
```

**Files to modify:**
- `packages/back-end/src/util/migrations.ts`
- `packages/back-end/test/util/migrations.test.ts`

**Dependencies:** Phase 1

### 2.2 Update Mongoose Schema & Integrate Migration

**Tasks:**
- [ ] Update `packages/back-end/src/models/FeatureModel.ts`:
  - Change `rules` schema from explicit field list to `rules: [{}]` (generic array of objects)
  - This allows both legacy format (empty array) and modern format (with uid, environments, allEnvironments)
  - Zod validation at API layer handles the actual validation
  - Consistent with existing pattern (`environmentSettings: {}`)
- [ ] Verify `toInterface()` calls `upgradeFeatureInterface()` (already does this)
- [ ] Update `FeatureRevisionModel.ts` to apply migration to revisions

**Files to modify:**
- `packages/back-end/src/models/FeatureModel.ts`
- `packages/back-end/src/models/FeatureRevisionModel.ts`

**Dependencies:** Phase 2.1

---

## Phase 3: Update Backend Services

### 3.1 Update Feature & Revision Services

**Tasks:**
- [ ] Update `packages/back-end/src/services/features.ts`:
  - Modify `getRules(feature, envId)` to filter `feature.rules` by environment
  - Create `getRuleByUid(feature, uid)` utility
  - Create `getRuleEnvironments(rule)` helper
  - Update `getApiFeatureObj()` to work with modern format
  - **CRITICAL**: Update SDK payload generation to handle modern format (payload format stays the same)
- [ ] Update `packages/back-end/src/models/FeatureModel.ts`:
  - Create `updateRuleByUid()` - modifies rule and handles permission checks
  - Create `addRuleToEnvironments()` - adds rule to specific environments
  - Create `removeRuleFromEnvironment()` - removes rule from specific env or deletes if last env
- [ ] Update `packages/back-end/src/models/FeatureRevisionModel.ts`:
  - Create revision-specific rule operations (similar to above)
  - Support both legacy and modern revision formats

**Permission Rules:**
- To add environment to rule: must have permission for that specific environment
- To modify rule in multiple environments: must have permission in **ALL** tagged environments

**Files to modify:**
- `packages/back-end/src/services/features.ts`
- `packages/back-end/src/models/FeatureModel.ts`
- `packages/back-end/src/models/FeatureRevisionModel.ts`

**Dependencies:** Phase 2

---

## Phase 4: REST API - Support Both v1 (Legacy) and v2 (Modern)

### 4.1 Implement REST API v1 with Legacy Format Support

**Tasks:**
- [ ] Update existing REST API v1 endpoints in `packages/back-end/src/api/`
- [ ] Ensure v1 accepts and returns **legacy format**:
  - Use `downgradeFeatureInterface()` before returning features
  - Use `downgradeFeatureRevision()` before returning revisions
  - Accept legacy format in POST/PUT requests
- [ ] Update validators to handle legacy format for v1

**Files to modify:**
- Existing REST API v1 endpoints (current structure)
- `packages/back-end/src/validators/openapi/*`

**Dependencies:** Phase 3

### 4.2 Add REST API v2 Routes with Modern Format

**Implementation Approach:**
- **NO separate v2/ directory** - keep all code in `packages/back-end/src/api/features/`
- Register both v1 and v2 routes in same router that point to same handlers
- Handlers check route version and apply/skip downgrade accordingly
- Version via path (`/v1/features/*` vs `/v2/features/*`), not folder structure
- Use OpenAPI tags (`Features (v1)` vs `Features (v2)`) for documentation

**Tasks:**
- [ ] Add v2 route registrations to existing features router:
  - `GET /v2/features/:id` - returns modern format (no downgrade)
  - `POST /v2/features` - accepts modern format
  - `PUT /v2/features/:id` - accepts modern format
- [ ] Add UID-based endpoints (v2 only):
  - `PUT /v2/features/:id/rules/:uid` - update specific rule by UID
  - `DELETE /v2/features/:id/rules/:uid` - delete rule
  - `POST /v2/features/:id/rules/:uid/environments` - add environments to rule
  - `DELETE /v2/features/:id/rules/:uid/environments/:envId` - remove environment
- [ ] Update OpenAPI spec with v2 routes, tagged appropriately
- [ ] Mark v1 routes as "legacy format" in OpenAPI descriptions

**Example Pattern:**
```typescript
// In features.router.ts
router.get("/v1/features/:id", async (req, res) => {
  const feature = await getFeature(req.context, req.params.id);
  res.json(downgradeFeatureInterface(feature)); // v1: legacy
});

router.get("/v2/features/:id", async (req, res) => {
  const feature = await getFeature(req.context, req.params.id);
  res.json(feature); // v2: modern format as-is
});

// UID-based endpoints only in v2
router.put("/v2/features/:id/rules/:uid", updateRuleByUid);
```

**Permission Validation:**
- Adding env to rule: must have permission for that env
- Modifying rule: must have permission for **ALL** environments the rule is in

**Files to modify:**
- `packages/back-end/src/api/features/features.router.ts`
- `packages/back-end/src/api/features/` (add UID-based endpoint handlers)
- `packages/back-end/generated/spec.yaml` (OpenAPI spec)

**Dependencies:** Phase 4.1

---

## Phase 5: Update Frontend Services

### 5.1 Update Feature Services

**Tasks:**
- [ ] Update `packages/front-end/services/features.ts`:
  - Modify `getRules(feature, envId)` to filter by environment
  - Add `getRuleByUid(feature, uid)` helper
  - Add `getRuleEnvironments(rule)` helper
- [ ] Update API client methods for v2 endpoints:
  - `updateRule(featureId, uid, updates)`
  - `deleteRule(featureId, uid, envId?)`
  - `addRuleToEnvironments(featureId, uid, envIds)`
  - `removeRuleFromEnvironment(featureId, uid, envId)`

**Files to modify:**
- `packages/front-end/services/features.ts`

**Dependencies:** Phase 4

---

## Phase 6: Update UI Components

### 6.1 Update Core Rule Components

**Tasks:**
- [ ] Update `packages/front-end/components/Features/Rule.tsx`:
  - Add environment badges showing which envs rule applies to
  - Update to work with `rule.environments` array
- [ ] Update `packages/front-end/components/Features/RuleList.tsx`:
  - Filter rules by current environment
  - Update drag-and-drop to work with UIDs
- [ ] Update `packages/front-end/components/Features/FeatureRules.tsx`:
  - Modify to show filtered rules per environment tab

**Files to modify:**
- `packages/front-end/components/Features/Rule.tsx`
- `packages/front-end/components/Features/RuleList.tsx`
- `packages/front-end/components/Features/FeatureRules.tsx`

**Dependencies:** Phase 5

### 6.2 Update Rule Modal

**Tasks:**
- [ ] Update `packages/front-end/components/Features/RuleModal/index.tsx`:
  - Add environment multi-selector
  - Validate permissions for selected environments
  - Allow editing which environments rule applies to

**Files to modify:**
- `packages/front-end/components/Features/RuleModal/index.tsx`

**Dependencies:** Phase 6.1

---

## Phase 7: Rule Reordering UI

### 7.1 Create Rule Reordering Modal

**Tasks:**
- [ ] Create `packages/front-end/components/Features/ReorderRulesModal.tsx`:
  - Show all rules with environment badges
  - Drag-and-drop to reorder
  - Save new order via API
- [ ] Add "Reorder Rules" button (disabled when filtered view active)

**Files to create:**
- `packages/front-end/components/Features/ReorderRulesModal.tsx`

**Dependencies:** Phase 6

---

## Phase 8: Testing & Validation

### 8.1 Core Testing

**Tasks:**
- [ ] Add unit tests for migration functions in `migrations.ts`
- [ ] Test SDK payload generation with modern format
- [ ] Test REST API v1 (legacy format) and v2 (modern format)
- [ ] Test permission validation for multi-env rules
- [ ] Integration tests for rule operations
- [ ] Test legacy/modern interop via both App API and REST API

**Critical Test Areas:**
- Migration correctness (no data loss)
- SDK payload format consistency
- Permission checks work correctly
- v1 and v2 API both work independently

**Files to create/modify:**
- `packages/back-end/test/util/migrations.test.ts`
- `packages/back-end/test/services/features.test.ts`
- `packages/back-end/test/api/v2/features/*.test.ts`

**Dependencies:** Phases 2-7

---

## Rollout Strategy

### Day 1-2: Backend Foundation
- Complete Phases 1-3
- JIT migration working
- SDK payload generation working with modern format

### Day 3-4: REST API v1/v2
- Complete Phase 4
- Both API versions working
- Test legacy/modern interop

### Day 5: Frontend & Reordering UI
- Complete Phases 5-7
- UI working with new structure
- Reordering modal functional

### Day 6-7: Testing & Deployment
- Complete Phase 8
- Integration testing
- Deploy to production

---

## Technical Considerations

### UID Generation Strategy

Use UUID v4 for rule UIDs:
```typescript
import { v4 as uuidv4 } from 'uuid';

function generateRuleUid(): string {
  return uuidv4();
}
```

### Environment Inheritance

**Decision:** No implicit inheritance
- Rules explicitly list all environments they apply to
- Migration does NOT dedupe - each env gets its own rule instance
- UI allows adding rule to multiple environments
- "All Environments" flag is explicit

### Rule Ordering

**Global ordering approach:**
- Rules have a single global order
- When filtering by environment, show subset in same order
- Reordering only available in global view (not filtered)
- Order persists across environment views

**Alternative (not recommended):**
- Per-environment ordering (more complex, harder to reason about)

### SDK Payload Generation

**CRITICAL**: The SDK payload format does NOT change, but the source data structure does.

- Ensure `getApiFeatureObj()` correctly processes modern format
- Filter rules by environment when building payload
- Test extensively that SDK payloads are identical before/after migration
- SDK clients should work without any changes

### REST API Versioning

**Approach: Path-based versioning, not folder-based**
- Version via route paths (`/v1/features/*` vs `/v2/features/*`)
- All code stays in same directory (`packages/back-end/src/api/features/`)
- Tag routes in OpenAPI spec with `Features (v1)` vs `Features (v2)`
- No code duplication - same handlers check version and apply/skip downgrade

**Format behavior:**
- **v1 REST API**: Returns/accepts legacy format (uses `downgradeFeatureInterface()`)
- **v2 REST API**: Returns/accepts modern format
- **App API** (internal): Always uses modern format
- Both v1 and v2 available indefinitely

**Independent versioning:**
- Each concern (Features, Experiments, etc.) can be independently versioned
- Only bump version for resources that actually changed
- Other endpoints stay at v1 until they need changes

**Key principle:**
- v1 is NOT deprecated - it's a permanent translation layer
- Allows external integrations to migrate at their own pace
- v2 offers better functionality (UID-based operations)

---

## Edge Cases to Handle

### 1. Environment Deletion
- What happens to rules when environment is deleted?
- Solution: Remove deleted env from `rule.environments` array, delete rule if array becomes empty

### 2. Permission Boundaries
- User has permission for some but not all environments in a rule
- Solution: Cannot modify rule unless have permission for ALL environments it's in

### 3. Identical Rules Across Environments
- Migration creates duplicate rule objects even if config is identical
- Solution: This is intentional - allows independent modification later

### 4. SDK Payload Consistency
- Must ensure SDK sees same payload before/after migration
- Solution: Extensive testing, filter rules by environment during payload generation

---

## Success Metrics

- [ ] 100% of features successfully migrate with JIT
- [ ] SDK payloads identical before/after migration
- [ ] Both REST API v1 and v2 work correctly
- [ ] Zero breaking changes for SDK clients
- [ ] App API and REST API interop works correctly

---

## Risk Mitigation

### High Risk: SDK Payload Changes
- **Mitigation:** Extensive testing, payload comparison scripts
- **Monitoring:** Monitor SDK error rates, feature evaluation correctness

### High Risk: REST API v1/v2 Interop Issues
- **Mitigation:** Test scenarios where v1 and v2 are used together, test app API + REST API interop
- **Monitoring:** API error rates, integration test coverage

### Medium Risk: Permission Logic Bugs
- **Mitigation:** Comprehensive permission tests, security review
- **Monitoring:** Audit log analysis, permission error tracking

---

## Key Decisions

1. **UID Format:** UUID v4 (standard, globally unique)
2. **Deduping:** NO - migration creates duplicates intentionally
3. **Migration:** JIT migration in `upgradeFeatureInterface()`, new writes automatically use modern format (no DB migration needed)
4. **API Versioning:** v1 (legacy) and v2 (modern) both permanent - not a deprecation scenario
5. **Permissions:** Must have ALL environments' permissions to modify multi-env rule

---

## Documentation Requirements

- [ ] Update API documentation (OpenAPI specs)
- [ ] Update feature flags guide
- [ ] Create migration guide for users
- [ ] Update SDK documentation (if needed)
- [ ] Create video tutorial for new UI
- [ ] Update architecture diagrams
- [ ] Create troubleshooting guide

---

## Files Summary

### New Files
- `packages/front-end/components/Features/ReorderRulesModal.tsx`
- UID-based endpoint handlers in `packages/back-end/src/api/features/`

### Key Modified Files
- `packages/back-end/src/validators/features.ts` (rename to legacy, create modern)
- `packages/back-end/src/util/migrations.ts` (add upgrade/downgrade functions)
- `packages/back-end/src/models/FeatureModel.ts` (integrate migration)
- `packages/back-end/src/models/FeatureRevisionModel.ts` (revision migration)
- `packages/back-end/src/services/features.ts` (**SDK payload generation**)
- `packages/back-end/src/api/features/features.router.ts` (add v2 routes alongside v1)
- `packages/back-end/generated/spec.yaml` (OpenAPI spec with v1/v2 tags)
- `packages/front-end/services/features.ts` (filter rules by env)
- `packages/front-end/components/Features/*.tsx` (UI updates)

---

---

## Build Order

1. Backend (schemas, migration, services, SDK payload)
2. REST APIs (v1 with downgrade, v2 with UID operations)
3. Frontend (UI updates, reordering modal)
4. Test and ship

