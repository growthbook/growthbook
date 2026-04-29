---
description: "Backend data model patterns using BaseModel/MakeModelClass"
globs: ["packages/back-end/src/models/**/*.ts"]
alwaysApply: false
---

# Backend Model Patterns

## Overview

GrowthBook uses a `BaseModel` pattern built on MongoDB. New models should use `MakeModelClass()` to create a base class, then extend it with permission logic and customize further if needed.

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
    // Audit logging config (optional)
    entity: "myResource",
    createEvent: "myResource.create",
    updateEvent: "myResource.update",
    deleteEvent: "myResource.delete",
  },
  globallyUniquePrimaryKeys: true, // IDs unique across all orgs
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

### Step 3: Add to the RequestContext so it can be used from anywhere

Add the model to `back-end/src/services/context.ts`. That way it can be referenced from anywhere. Use the plural version of the model name here. For example:

```ts
const resource = req.context.myResources.getById("abc123");
```

## Configuration Options

### MakeModelClass Config

| Option                      | Type       | Required | Description                                                                                                                                                                                      |
| --------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`                    | Zod schema | Yes      | Validator from `shared/validators`                                                                                                                                                               |
| `collectionName`            | string     | Yes      | MongoDB collection name                                                                                                                                                                          |
| `pKey`                      | string[]   | No       | Primary key fields. Defaults to `["id"]`. Use e.g. `["userId", "organization"] as const` for composite keys. Must use `as const` so TypeScript narrows the tuple for compile-time update safety. |
| `idPrefix`                  | string     | No       | Prefix for auto-generated IDs (e.g., "prj\_"). Only applies when schema has an `id` field.                                                                                                       |
| `auditLog`                  | object     | No       | Audit event configuration                                                                                                                                                                        |
| `globallyUniquePrimaryKeys` | boolean    | No       | Create an additional unique index on the primary key alone (without `organization`)                                                                                                              |
| `defaultValues`             | object     | No       | Default values applied on creation                                                                                                                                                               |
| `readonlyFields`            | string[]   | No       | Fields that cannot be updated after creation                                                                                                                                                     |
| `skipDateUpdatedFields`     | string[]   | No       | Fields that don't trigger `dateUpdated` when changed                                                                                                                                             |
| `additionalIndexes`         | array      | No       | Extra MongoDB indexes to create                                                                                                                                                                  |
| `apiConfig`                 | object     | No       | Exposes the model via the external REST API. Set `modelKey` and `openApiSpec`. Requires implementing `toApiInterface` in the model class. See `api-patterns.md` for the full spec-based pattern. |

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

// Get by ID (only valid when schema has an "id" field)
const doc = await model.getById("res_abc123");

// Get multiple by IDs (only valid when schema has an "id" field)
const docs = await model.getByIds(["res_abc123", "res_def456"]);

// Get all (with optional filter)
const allDocs = await model.getAll();
const filtered = await model.getAll({ status: "active" });
```

`getById` and `getByIds` will throw at runtime if the schema has no `id` field. Models with composite or non-standard primary keys must expose their own accessor methods instead (see "Alternate Primary Keys" below).

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

// Update by ID (only valid when schema has an "id" field)
const updated = await model.updateById("res_abc123", { name: "New Name" });

// Delete
await model.delete(existingDoc);
await model.deleteById("res_abc123"); // only valid when schema has an "id" field
```

### Bypass Permission (Use Sparingly)

For system operations that shouldn't check user permissions:

```typescript
// Only use when truly necessary (e.g., system migrations, webhooks)
await model.dangerousCreateBypassPermission(data);
await model.dangerousUpdateByIdBypassPermission(id, updates);
```

## Adding Custom Methods

You can add more tailored data fetching methods as needed by referencing the `_findOne` and `_find` methods. There are similar protected methods for write operations, although those are rarely needed.

Here's an example:

```ts
export class FooDataModel extends BaseClass {
  // ...

  public getByNames(names: string[]) {
    return this._find({ name: { $in: names } });
  }
}
```

Note: Permission checks, migrations, etc. are all done automatically within the `_find` method, so you don't need to repeat any of that in your custom methods. Also, the `organization` field is automatically added to every query, so it will always be multi-tenant safe.

## Alternate Primary Keys

For models where the unique primary key isn't `id`, use the `pKey` config option. This can be a single field like `uid`, or a composite key like `organization` + `userId`. The schema should be built with `createBaseSchemaWithPrimaryKey` from `shared/validators`.

```typescript
import { createBaseSchemaWithPrimaryKey } from "shared/validators";

// Schema: userId + organization together form the primary key
const mySchema = createBaseSchemaWithPrimaryKey({
  userId: z.string(),
  organization: z.string(),
}).extend({ name: z.string() });

const BaseClass = MakeModelClass({
  schema: mySchema,
  collectionName: "myresources",
  pKey: ["userId", "organization"] as const,
  // No idPrefix — id is not auto-generated for composite-key models
  // `as const` is required so TypeScript can forbid pKey fields in UpdateProps
});
```

**Important differences from standard `id`-based models:**

- `getById`, `getByIds`, `updateById`, `deleteById`, and `dangerousUpdateByIdBypassPermission` will throw — do not call them.
- During creation `id` and `uid` will still be auto-generated if present in the schema. Any other primary key fields (e.g. `userId`) must be supplied by the caller.
- MongoDB update and delete filters use all pKey fields instead of `{ id }`.
- Audit log entity IDs are serialized as a JSON object string, e.g. `{"userId":"u1","organization":"org1"}`.

Expose semantic accessor methods that delegate to the protected `_findOne`/`_find`:

```typescript
export class MyResourceModel extends BaseClass {
  // ...permissions...

  public getByUserId(userId: string) {
    return this._findOne({ userId });
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
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    description: "",
    enabled: false,
  },
  readonlyFields: ["organization"],
});

export class WidgetModel extends BaseClass {
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
    return this._find({ project: projectId, enabled: true });
  }
}
```

## Key Points

1. **Always use MakeModelClass** for new models (unless there's a specific reason not to)
2. **Implement all four permission methods** - canRead, canCreate, canUpdate, canDelete
3. **Use hooks for side effects** - afterUpdate for cache invalidation, beforeDelete for dependency checks
4. **Use migrate() for schema evolution** - handles legacy documents gracefully
5. **Choose appropriate ID prefix** - follow existing conventions (only for `id`-based models)
6. **Enable audit logging** - for user-facing entities that need tracking
7. **Alternate primary key models must not use `getById`/`getByIds` etc** - expose semantic accessors via `_findOne`/`_find` instead
