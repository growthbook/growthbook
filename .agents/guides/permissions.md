# Permission System

## Overview

GrowthBook uses a three-tier permission system with Global, Project-scoped, and Environment-scoped permissions. Permissions work alongside commercial features - both gates must pass for access.

## Permission Scopes

### Global Permissions

Apply organization-wide, not restricted to projects or environments:

- `manageTeam`, `manageBilling`, `manageApiKeys`
- `organizationSettings`, `viewAuditLog`
- `createPresentations`, `createDimensions`, `manageNamespaces`
- `manageCustomRoles`, `manageCustomFields`, `manageDecisionCriteria`

### Project-Scoped Permissions

Can be granted for all projects or specific projects:

- `readData`, `addComments`
- per flag entity (`Features`/`Configs`/`Constants`): `edit*Drafts`, `review*`,
  `bypassApproval*`
- `editSavedGroupDrafts`, `reviewSavedGroups`, `publishSavedGroups`,
  `revertSavedGroups`, `createSavedGroups`, `deleteSavedGroups`,
  `bypassApprovalSavedGroups`
- `createMetrics`, `createAnalyses`, `createSegments`
- `manageFactTables`, `manageFactMetrics`
- `manageTargetingAttributes`
- `createDatasources`, `editDatasourceSettings`, `runQueries`

### Environment-Scoped Permissions

Further restricted to specific environments within projects:

- per flag entity: `create*`, `publish*`, `revert*` - live writes
- per flag entity: `delete*` - archiving is environment-scoped; deleting an
  archived flag is not (pass `NO_ENVIRONMENT_BINDING`)
- `runExperiments` - Start/stop experiments
- `manageEnvironments` - Create/edit environments
- `manageSDKConnections` - Manage SDK connections
- `manageSDKWebhooks` - Manage SDK webhooks

## Frontend Permission Checking

### Using usePermissionsUtil()

The primary hook for checking permissions:

```typescript
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

function MyComponent() {
  const permissionsUtil = usePermissionsUtil();

  // Global permission check
  if (!permissionsUtil.canManageTeam()) {
    return <NoAccess />;
  }

  // Project-scoped check
  if (!permissionsUtil.canCreateFeature({ project: "prj_123" })) {
    return <NoAccess />;
  }

  // Environment-scoped check
  if (!permissionsUtil.canPublishFeature(feature, ["production"])) {
    return <NoAccess />;
  }

  return <MyContent />;
}
```

### Common Permission Check Methods

```typescript
const permissionsUtil = usePermissionsUtil();

// Feature permissions
permissionsUtil.canCreateFeature({ project }, environments);
permissionsUtil.canEditFeatureDrafts(feature);
permissionsUtil.canReviewFeatureDrafts(feature);
permissionsUtil.canDeleteFeature(feature, environments);
permissionsUtil.canPublishFeature(feature, environments);
permissionsUtil.canRevertFeature(feature, environments);

// Experiment permissions
permissionsUtil.canCreateExperiment({ project });
permissionsUtil.canUpdateExperiment(existingExp, updatedExp);
permissionsUtil.canRunExperiment(experiment, environments);

// Metric permissions
permissionsUtil.canCreateMetric({ projects });
permissionsUtil.canUpdateMetric(existingMetric, updatedMetric);
permissionsUtil.canDeleteMetric(metric);

// Project permissions
permissionsUtil.canReadSingleProjectResource(projectId);
permissionsUtil.canReadMultiProjectResource(projectIds);
permissionsUtil.canManageSomeProjects();

// General checks
permissionsUtil.canViewFeatureModal(project);
permissionsUtil.canViewExperimentModal(project);
```

### Using Raw Permissions

For simple global permission checks:

```typescript
import usePermissions from "@/hooks/usePermissions";

function MyComponent() {
  const permissions = usePermissions();

  if (permissions.manageTeam) {
    // Show team management UI
  }

  if (permissions.viewAuditLog) {
    // Show audit log link
  }
}
```

### Conditional Rendering Pattern

```typescript
function FeatureActions({ feature }: { feature: FeatureInterface }) {
  const permissionsUtil = usePermissionsUtil();

  return (
    <div>
      {permissionsUtil.canEditFeatureDrafts(feature) && (
        <Button onClick={handleEdit}>Edit</Button>
      )}

      {permissionsUtil.canDeleteFeature(feature, NO_ENVIRONMENT_BINDING) && (
        <Button variant="danger" onClick={handleDelete}>Delete</Button>
      )}

      {permissionsUtil.canPublishFeature(feature, ["production"]) && (
        <Button onClick={handlePublish}>Publish to Production</Button>
      )}
    </div>
  );
}
```

## Backend Permission Checking

### In Controllers/Routers

Access permissions through the request context:

```typescript
import { getContextFromReq } from "back-end/src/services/organizations";

export async function updateFeature(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const updates = req.body;

  // Get existing document
  const feature = await getFeatureById(context, id);
  if (!feature) {
    return res.status(404).json({ error: "Feature not found" });
  }

  // Check permission. `updateFeature` writes LIVE state, so this is publish-class
  // over the environments the change reaches — draft authority alone authorizes
  // proposing a change, not landing one. Use canEditFeatureDrafts only for writes
  // that stop at a revision.
  if (
    !context.permissions.canPublishFeature(
      feature,
      Array.from(getEnabledEnvironments(feature, environmentIds)),
    )
  ) {
    context.permissions.throwPermissionError();
  }

  // Proceed with update
  const updated = await updateFeature(context, id, updates);
  res.json({ feature: updated });
}
```

> An edit is a draft plus a publish. If a handler writes live state, gating it on
> draft authority hands a drafter the publish they were deliberately not given.

### Permission Methods in Context

```typescript
const context = getContextFromReq(req);

// Global permissions
context.permissions.canManageTeam();
context.permissions.canManageOrgSettings();
context.permissions.canViewAuditLogs();
context.permissions.canManageBilling();

// Project-scoped permissions
context.permissions.canEditFeatureDrafts(feature);
context.permissions.canReviewFeatureDrafts(feature);

// Environment-scoped permissions
context.permissions.canPublishFeature(feature, environments);
context.permissions.canRunExperiment(experiment, environments);

// Throw error if permission denied
context.permissions.throwPermissionError();
context.permissions.throwPermissionError("Custom error message");
```

### In Models

Models use permission methods internally:

```typescript
class MyResourceModel extends BaseClass {
  protected canRead(doc: MyResourceInterface) {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate() {
    return this.context.permissions.canCreateMyResource();
  }

  protected canUpdate(doc: MyResourceInterface) {
    return this.context.permissions.canUpdateMyResource(doc);
  }

  protected canDelete(doc: MyResourceInterface) {
    return this.context.permissions.canDeleteMyResource(doc);
  }
}
```

## Commercial Features

Commercial features are a separate gate from permissions. A user might have permission but the organization's plan might not include the feature.

### Frontend - Check Feature Availability

```typescript
import { useUser } from "@/services/UserContext";

function MyComponent() {
  const { hasCommercialFeature } = useUser();

  if (!hasCommercialFeature("advanced-permissions")) {
    return <UpgradePrompt />;
  }

  return <AdvancedPermissionsUI />;
}
```

### Frontend - PremiumTooltip Wrapper

Wrap premium features to show upgrade prompts:

```typescript
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

function MyComponent() {
  return (
    <PremiumTooltip commercialFeature="advanced-permissions">
      <Button disabled={!hasFeature} onClick={handleClick}>
        Advanced Settings
      </Button>
    </PremiumTooltip>
  );
}
```

### Backend - Check Feature Availability

```typescript
import { orgHasPremiumFeature } from "back-end/src/enterprise/licenseUtil";

export async function createArchetype(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  // Check permission first
  if (!context.permissions.canCreateArchetype(req.body)) {
    context.permissions.throwPermissionError();
  }

  // Then check commercial feature
  if (!orgHasPremiumFeature(context.org, "archetypes")) {
    throw new PlanDoesNotAllowError("Archetypes require a Pro plan or higher");
  }

  // Proceed with creation
  const archetype = await createArchetype(context, req.body);
  res.json({ archetype });
}
```

### Common Commercial Features

- `advanced-permissions` - Custom roles and project-level permissions
- `teams` - Team management
- `audit-logging` - Audit log access
- `archetypes` - User archetypes
- `templates` - Experiment templates
- `sso` - Single sign-on
- `encrypt-features-endpoint` - SDK endpoint encryption
- `ai-suggestions` - AI-powered suggestions

## Roles and Policies

### Default Roles

| Role           | Description                   |
| -------------- | ----------------------------- |
| `noaccess`     | No permissions                |
| `readonly`     | Read-only access              |
| `collaborator` | Read + comments + ideas       |
| `visualEditor` | Visual editor access          |
| `engineer`     | Features + SDK + environments |
| `analyst`      | Analytics + metrics + SQL     |
| `experimenter` | Engineer + analyst combined   |
| `admin`        | Full access                   |

### How Permissions Resolve

1. User has a global role (organization-wide)
2. User can have project-specific role overrides
3. User can be on teams with their own roles
4. Permissions merge using OR logic (union)
5. Environment limits apply only to environment-scoped permissions

## Best Practices

### 1. Check Permissions Early

```typescript
// Good - check at start of handler
if (!context.permissions.canEditFeatureDrafts(feature)) {
  context.permissions.throwPermissionError();
}

// Bad - check after doing work
const revision = await createRevision(...);
if (!context.permissions.canEditFeatureDrafts(feature)) {
  throw new Error("No permission"); // the draft is already on disk
}
```

### 2. Use Specific Permission Methods

```typescript
// Good - use the specific method
if (!permissionsUtil.canEditFeatureDrafts(feature)) {
  return <NoAccess />;
}

// Bad - check raw permission without context
if (!permissions.editFeatureDrafts) {
  return <NoAccess />;
}
```

There is no "edit" verb. A content change is a draft plus a publish, so authoring
gates on `canEditFeatureDrafts` and landing gates on `canPublishFeature` with the
environments the change touches. Saved groups use the generic form directly:
`canRevisionAction("saved-group", action, obj)`.

Atoms are per entity, one per (model, action) — see `revisionPermissions.ts`.
Roles never name them: an organization grants POLICIES, and a policy bundles the
three flag entities. Add capability by adding a policy, not by exposing an atom.

### 3. Pass the Environments a Change Touches

```typescript
// Good - the environments this publish actually writes to
const canPublish = permissionsUtil.canPublishFeature(feature, changedEnvs);

// Bad - every org environment, which demands authority the change doesn't need
const canPublish = permissionsUtil.canPublishFeature(feature, allOrgEnvs);
```

Pass `NO_ENVIRONMENT_BINDING` when a change has no environment — a base Config, a
Constant's base value, deleting an already-archived flag. An empty array skips
the environment check, so never pass one by accident.

### 4. Handle Both Permission and Feature Gates

```typescript
// Frontend
const { hasCommercialFeature } = useUser();
const permissionsUtil = usePermissionsUtil();

const canAccess =
  hasCommercialFeature("feature-name") && permissionsUtil.canDoSomething();

// Backend
if (!context.permissions.canDoSomething()) {
  context.permissions.throwPermissionError();
}
if (!orgHasPremiumFeature(context.org, "feature-name")) {
  throw new PlanDoesNotAllowError("Feature not available");
}
```

### 5. Don't Hardcode Permission Logic

```typescript
// Good - use permission utilities
if (!permissionsUtil.canManageSomeProjects()) {
  return null;
}

// Bad - hardcode role checks
if (user.role !== "admin" && user.role !== "engineer") {
  return null;
}
```

## Permission Definitions Location

- Permission constants: `packages/shared/src/permissions/permissions.constants.ts`
- Permission utilities: `packages/shared/src/permissions/permissions.utils.ts`
- Permissions class: `packages/shared/src/permissions/permissionsClass.ts`
- Frontend hooks: `packages/front-end/hooks/usePermissions.ts`, `usePermissionsUtils.ts`
- Backend resolution: `packages/back-end/src/util/organization.util.ts`
