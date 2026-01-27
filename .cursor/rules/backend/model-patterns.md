---
description: "Backend data model patterns using BaseModel/MakeModelClass"
globs: ["packages/back-end/src/models/**/*.ts"]
alwaysApply: false
---

# Backend Model Patterns

## Overview

GrowthBook uses a `BaseModel` pattern built on MongoDB. New models should use `MakeModelClass()` to create a base class, then extend it with permission logic.

**Location:** `packages/back-end/src/models/`

## Creating a New Model

### Step 1: Create the Base Class

```typescript
// In packages/back-end/src/models/MyResourceModel.ts
import { MakeModelClass } from "./BaseModel";
import { myResourceValidator } from "shared/validators";

const BaseClass = MakeModelClass({
  schema: myResourceValidator, // Zod schema from shared
  collectionName: "myresources", // MongoDB collection name
  idPrefix: "res_", // ID prefix for generation
  auditLog: {
    // Audit logging config
    entity: "myResource",
    createEvent: "myResource.create",
    updateEvent: "myResource.update",
    deleteEvent: "myResource.delete",
  },
  globallyUniqueIds: true, // IDs unique across all orgs
  defaultValues: {
    // Default field values
    description: "",
    settings: {},
  },
});
```

### Step 2: Extend with Permission Logic

```typescript
export class MyResourceModel extends BaseClass {
  // Required: Check if user can read this document
  protected canRead(doc: MyResourceInterface) {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  // Required: Check if user can create documents
  protected canCreate() {
    return this.context.permissions.canCreateMyResource();
  }

  // Required: Check if user can update this document
  protected canUpdate(doc: MyResourceInterface) {
    return this.context.permissions.canUpdateMyResource(doc);
  }

  // Required: Check if user can delete this document
  protected canDelete(doc: MyResourceInterface) {
    return this.context.permissions.canDeleteMyResource(doc);
  }
}
```

### Step 3: Export Functions (Not the Class)

Models should NOT export the class directly. Export functions instead:

```typescript
// Good - export functions
export async function getMyResourceById(context: ReqContext, id: string) {
  return new MyResourceModel(context).getById(id);
}

export async function createMyResource(
  context: ReqContext,
  data: CreateMyResourceInput,
) {
  return new MyResourceModel(context).create(data);
}

export async function updateMyResource(
  context: ReqContext,
  id: string,
  updates: UpdateMyResourceInput,
) {
  return new MyResourceModel(context).updateById(id, updates);
}

export async function deleteMyResource(context: ReqContext, id: string) {
  return new MyResourceModel(context).deleteById(id);
}

// Bad - don't export the class
// export { MyResourceModel };
```

## Configuration Options

### MakeModelClass Config

| Option                  | Type       | Required | Description                                                |
| ----------------------- | ---------- | -------- | ---------------------------------------------------------- |
| `schema`                | Zod schema | Yes      | Validator from `shared/validators`                         |
| `collectionName`        | string     | Yes      | MongoDB collection name                                    |
| `idPrefix`              | string     | No       | Prefix for auto-generated IDs (e.g., "prj\_")              |
| `auditLog`              | object     | No       | Audit event configuration                                  |
| `globallyUniqueIds`     | boolean    | No       | Create unique index on `id` only (not `id + organization`) |
| `defaultValues`         | object     | No       | Default values applied on creation                         |
| `readonlyFields`        | string[]   | No       | Fields that cannot be updated after creation               |
| `skipDateUpdatedFields` | string[]   | No       | Fields that don't trigger `dateUpdated` when changed       |
| `additionalIndexes`     | array      | No       | Extra MongoDB indexes to create                            |

### Audit Log Config

```typescript
auditLog: {
  entity: "project",              // Entity type for audit system
  createEvent: "project.create",  // Event name for creates
  updateEvent: "project.update",  // Event name for updates
  deleteEvent: "project.delete",  // Event name for deletes
}
```

## ID Prefix Conventions

Use consistent prefixes for entity IDs:

| Entity       | Prefix   | Example        |
| ------------ | -------- | -------------- |
| Project      | `prj_`   | `prj_abc123`   |
| Experiment   | `exp_`   | `exp_xyz789`   |
| Feature      | `feat_`  | `feat_def456`  |
| Saved Group  | `grp_`   | `grp_ghi012`   |
| Segment      | `seg_`   | `seg_jkl345`   |
| Metric       | `met_`   | `met_mno678`   |
| Webhook      | `wh_`    | `wh_pqr901`    |
| API Key      | `key_`   | `key_stu234`   |
| Custom Field | `cfd_`   | `cfd_vwx567`   |
| Safe Rollout | `sr_`    | `sr_yza890`    |
| Holdout      | `hld_`   | `hld_bcd123`   |
| Fact Table   | `fact__` | `fact__efg456` |
| URL Redirect | `url_`   | `url_hij789`   |

## Lifecycle Hooks

Override these methods to add custom logic:

### Validation Hook

```typescript
protected async customValidation(doc: MyResourceInterface) {
  if (doc.name.length < 3) {
    throw new Error("Name must be at least 3 characters");
  }
}
```

### Create Hooks

```typescript
protected async beforeCreate(doc: MyResourceInterface) {
  // Called before document is inserted
  doc.computedField = calculateValue(doc);
}

protected async afterCreate(doc: MyResourceInterface) {
  // Called after document is inserted
  await notifyExternalService(doc);
}
```

### Update Hooks

```typescript
protected async beforeUpdate(
  existing: MyResourceInterface,
  updates: Partial<MyResourceInterface>,
  newDoc: MyResourceInterface
) {
  // Called before update is applied
}

protected async afterUpdate(
  existing: MyResourceInterface,
  updates: Partial<MyResourceInterface>,
  newDoc: MyResourceInterface
) {
  // Called after update - useful for cache invalidation
  if (updates.rules || updates.settings) {
    await invalidateSDKCache(this.context);
  }
}
```

### Delete Hooks

```typescript
protected async beforeDelete(doc: MyResourceInterface) {
  // Check for dependencies before allowing delete
  const dependents = await findDependents(doc.id);
  if (dependents.length > 0) {
    throw new Error("Cannot delete: has dependent resources");
  }
}

protected async afterDelete(doc: MyResourceInterface) {
  // Cleanup after delete
  await cleanupRelatedData(doc.id);
}
```

## Data Migration

Handle legacy document formats with the `migrate()` method:

```typescript
protected migrate(legacyDoc: LegacyMyResourceInterface): MyResourceInterface {
  const { oldField, deprecatedProperty, ...rest } = legacyDoc;

  return {
    ...rest,
    // Map old field to new structure
    newField: oldField ?? "default",
    // Remove deprecated properties by not including them
  };
}
```

Migration runs automatically when documents are read, transforming legacy data to the current schema.

## Built-in CRUD Methods

### Read Operations

```typescript
const model = new MyResourceModel(context);

// Get by ID
const doc = await model.getById("res_abc123");

// Get multiple by IDs
const docs = await model.getByIds(["res_abc123", "res_def456"]);

// Get all (with optional filter)
const allDocs = await model.getAll();
const filtered = await model.getAll({ status: "active" });
```

### Write Operations

```typescript
const model = new MyResourceModel(context);

// Create
const newDoc = await model.create({
  name: "My Resource",
  settings: { enabled: true },
});

// Update by document
const updated = await model.update(existingDoc, { name: "New Name" });

// Update by ID
const updated = await model.updateById("res_abc123", { name: "New Name" });

// Delete
await model.delete(existingDoc);
await model.deleteById("res_abc123");
```

### Bypass Permission (Use Sparingly)

For system operations that shouldn't check user permissions:

```typescript
// Only use when truly necessary (e.g., system migrations, webhooks)
await model.dangerousCreateBypassPermission(data);
await model.dangerousUpdateByIdBypassPermission(id, updates);
```

## Adding Custom Methods

Add domain-specific methods to your model:

```typescript
export class MyResourceModel extends BaseClass {
  // ... permission methods ...

  // Custom query method
  async getByProject(projectId: string): Promise<MyResourceInterface[]> {
    return this.getAll({ project: projectId });
  }

  // Custom business logic
  async archive(id: string): Promise<MyResourceInterface> {
    const doc = await this.getById(id);
    if (!doc) throw new Error("Resource not found");

    return this.update(doc, {
      archived: true,
      dateArchived: new Date(),
    });
  }

  // Bulk operations
  async bulkUpdateStatus(ids: string[], status: string): Promise<void> {
    for (const id of ids) {
      await this.updateById(id, { status });
    }
  }
}
```

## Complete Example

```typescript
// packages/back-end/src/models/WidgetModel.ts
import { MakeModelClass } from "./BaseModel";
import { widgetValidator, WidgetInterface } from "shared/validators";
import { ReqContext } from "../types";

const BaseClass = MakeModelClass({
  schema: widgetValidator,
  collectionName: "widgets",
  idPrefix: "wgt_",
  auditLog: {
    entity: "widget",
    createEvent: "widget.create",
    updateEvent: "widget.update",
    deleteEvent: "widget.delete",
  },
  globallyUniqueIds: true,
  defaultValues: {
    description: "",
    enabled: false,
  },
  readonlyFields: ["organization"],
});

class WidgetModel extends BaseClass {
  protected canRead(doc: WidgetInterface) {
    return this.context.permissions.canReadSingleProjectResource(doc.project);
  }

  protected canCreate() {
    return this.context.permissions.canCreateWidget();
  }

  protected canUpdate(doc: WidgetInterface) {
    return this.context.permissions.canUpdateWidget(doc);
  }

  protected canDelete(doc: WidgetInterface) {
    return this.context.permissions.canDeleteWidget(doc);
  }

  protected async afterUpdate(
    existing: WidgetInterface,
    updates: Partial<WidgetInterface>,
  ) {
    if (updates.enabled !== undefined) {
      await this.context.logger.info("Widget enabled state changed", {
        widgetId: existing.id,
        enabled: updates.enabled,
      });
    }
  }

  // Custom method
  async getEnabledByProject(projectId: string): Promise<WidgetInterface[]> {
    return this.getAll({ project: projectId, enabled: true });
  }
}

// Export functions, not the class
export async function getWidgetById(context: ReqContext, id: string) {
  return new WidgetModel(context).getById(id);
}

export async function createWidget(
  context: ReqContext,
  data: Omit<WidgetInterface, "id" | "dateCreated" | "dateUpdated">,
) {
  return new WidgetModel(context).create(data);
}

export async function updateWidget(
  context: ReqContext,
  id: string,
  updates: Partial<WidgetInterface>,
) {
  return new WidgetModel(context).updateById(id, updates);
}

export async function deleteWidget(context: ReqContext, id: string) {
  return new WidgetModel(context).deleteById(id);
}

export async function getEnabledWidgetsByProject(
  context: ReqContext,
  projectId: string,
) {
  return new WidgetModel(context).getEnabledByProject(projectId);
}
```

## Key Points

1. **Always use MakeModelClass** for new models (unless there's a specific reason not to)
2. **Implement all four permission methods** - canRead, canCreate, canUpdate, canDelete
3. **Export functions, not the class** - keeps API clean and testable
4. **Use hooks for side effects** - afterUpdate for cache invalidation, beforeDelete for dependency checks
5. **Use migrate() for schema evolution** - handles legacy documents gracefully
6. **Choose appropriate ID prefix** - follow existing conventions
7. **Enable audit logging** - for user-facing entities that need tracking
