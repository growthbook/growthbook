/* eslint-disable @typescript-eslint/no-unused-vars */

import { v4 as uuidv4 } from "uuid";
import mongoose, { FilterQuery } from "mongoose";
import {
  AnyBulkWriteOperation,
  Collection,
  Document,
  UpdateFilter,
} from "mongodb";
import omit from "lodash/omit";
import { z } from "zod";
import { isEqual, pick } from "lodash";
import { evalCondition } from "@growthbook/growthbook";
import { BaseSchemaWithPrimaryKey } from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { EntityType, EventType } from "shared/types/audit";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  createModelAuditLogger,
  type AuditLogConfig,
} from "back-end/src/services/audit";
import {
  ForeignKeys,
  ForeignRefs,
  ForeignRefsCacheKeys,
} from "back-end/src/services/context";
import { ApiRequest } from "back-end/src/util/handler";
import {
  ApiBaseSchema,
  ApiModelConfig,
  CrudValidatorOverrides,
  DefaultCrudValidators,
} from "back-end/src/api/ApiModel";
import { CrudAction } from "back-end/src/api/apiModelHandlers";
import { dbSafeBulkWrite } from "back-end/src/util/mongo.util";
import { generateId } from "back-end/src/util/uuid";
import {
  resolveOwnerEmail,
  resolveOwnerEmails,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";

export type Context = ApiReqContext | ReqContext;

type PKeyType<
  T extends BaseSchemaWithPrimaryKey<PKey>,
  PKey extends z.ZodRawShape,
> = readonly [keyof z.infer<T>, ...(keyof z.infer<T>)[]];
const DEFAULT_PKEY = ["id"] as const;

export type ScopedFilterQuery<
  T extends BaseSchemaWithPrimaryKey<PKey>,
  PKey extends z.ZodRawShape,
> = FilterQuery<Omit<z.infer<T>, "organization">>;

export type CreateZodObject<
  T extends BaseSchemaWithPrimaryKey<PKey>,
  PKey extends z.ZodRawShape,
> = z.ZodType<CreateProps<z.infer<T>>>;

export const createSchema = <
  T extends BaseSchemaWithPrimaryKey<PKey>,
  PKey extends z.ZodRawShape,
>(
  schema: T,
) => {
  const omitShape: Record<string, true> = {
    organization: true,
    dateCreated: true,
    dateUpdated: true,
  };
  if ("id" in schema.shape) omitShape.id = true;
  if ("uid" in schema.shape) omitShape.uid = true;
  let output = schema.omit(omitShape) as z.ZodObject<z.ZodRawShape>;
  if ("id" in schema.shape)
    output = output.extend({ id: z.string().optional() });
  if ("uid" in schema.shape)
    output = output.extend({ uid: z.string().optional() });
  return output.strict() as unknown as CreateZodObject<T, PKey>;
};

/**
 * UpdateProps scoped to a specific model's primary key — forbids both the
 * standard protected base fields AND whatever fields comprise the pKey.
 *
 * PK is the literal tuple of primary key field names (e.g. readonly ["id"]
 * or readonly ["userId", "organization"]).  The tuple passed to MakeModelClass
 * will be defined with `as const` so that PK[number] resolves to a narrow string
 * literal union rather than just `string`.
 */
type PKeyUpdateProps<
  T extends BaseSchemaWithPrimaryKey<PKey>,
  PKey extends z.ZodRawShape,
  PK extends readonly string[],
> = UpdateProps<z.infer<T>, PK[number] & string>;

export type UpdateZodObject<
  T extends BaseSchemaWithPrimaryKey<PKey>,
  PKey extends z.ZodRawShape,
  PK extends readonly string[],
> = z.ZodType<PKeyUpdateProps<T, PKey, PK>>;

const updateSchema = <
  T extends BaseSchemaWithPrimaryKey<PKey>,
  PKey extends z.ZodRawShape,
>(
  schema: T,
  pKey?: PKeyType<T, PKey>,
) => {
  const omitShape: Record<string, true> = {
    organization: true,
    dateCreated: true,
    dateUpdated: true,
  };
  if ("id" in schema.shape) omitShape.id = true;
  if ("uid" in schema.shape) omitShape.uid = true;
  // Also omit custom primary key fields
  if (pKey) {
    for (const k of pKey) {
      omitShape[k as string] = true;
    }
  }
  return schema
    .omit(omitShape)
    .partial()
    .strict() as unknown as UpdateZodObject<T, PKey, readonly string[]>;
};

// Drop `undefined` for top-level schema fields that can't be absent (required,
// or .nullable() without .optional()). Matches ORM "ignore undefined" semantics
// and keeps bulkWrite aligned with update().
const dropNonClearableUndefined = (
  schema: z.ZodObject<z.ZodRawShape>,
  fields: Record<string, unknown>,
): void => {
  for (const [k, v] of Object.entries(fields)) {
    if (
      v === undefined &&
      k in schema.shape &&
      !z.safeParse(schema.shape[k], undefined).success
    ) {
      delete fields[k];
    }
  }
};

// Explicitly-undefined $set fields mean "clear this field" — translate them to
// $unset, since ignoreUndefined would otherwise silently drop them
const translateUndefinedSetToUnset = (
  update: UpdateFilter<Document>,
): UpdateFilter<Document> => {
  const { $set, $unset, ...rest } = update;
  if (!$set) return update;
  const setFields: Record<string, unknown> = {};
  const unsetFields: Record<string, unknown> = { ...$unset };
  for (const [k, v] of Object.entries($set)) {
    if (v === undefined) unsetFields[k] = "";
    else setFields[k] = v;
  }
  return {
    ...rest,
    ...(Object.keys(setFields).length ? { $set: setFields } : {}),
    ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
  } as UpdateFilter<Document>;
};

const normalizeUpdateOneDocument = (
  schema: z.ZodObject<z.ZodRawShape>,
  update: UpdateFilter<Document>,
): UpdateFilter<Document> => {
  const { $set, $unset, ...rest } = update;
  if (!$set || typeof $set !== "object" || Array.isArray($set)) {
    return translateUndefinedSetToUnset(update);
  }
  const setFields = { ...($set as Record<string, unknown>) };
  dropNonClearableUndefined(schema, setFields);
  return translateUndefinedSetToUnset({
    ...rest,
    ...($unset ? { $unset } : {}),
    $set: setFields,
  });
};

// DeepPartial makes all properties (including nested) optional
type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: T[P] extends (infer U)[]
        ? DeepPartial<U>[]
        : T[P] extends readonly (infer U)[]
          ? readonly DeepPartial<U>[]
          : DeepPartial<T[P]>;
    }
  : T;

/**
 * Type-safe index field paths: top-level keys only, or dotted paths whose first
 * segment is a top-level key (e.g. "nextScheduledStatusUpdate.date").
 * Avoids deep recursion that would occur with fully recursive path types.
 */
export type IndexableFieldPath<T> = T extends object
  ? keyof T extends string
    ? keyof T | `${keyof T}.${string}`
    : keyof T
  : never;

export interface ModelConfig<
  T extends BaseSchemaWithPrimaryKey<PKey>,
  Entity extends EntityType,
  ApiT extends ApiBaseSchema,
  PKey extends z.ZodRawShape,
> {
  schema: T;
  collectionName: string;
  /**
   * Primary key field names. Omit for default ["id"]. Use e.g. ["userId", "organization"]
   * for composite keys. Used for queries, updates, deletes, and index creation.
   */
  pKey?: PKeyType<T, PKey>;
  idPrefix?: string;
  auditLog?: AuditLogConfig<Entity>;
  globallyUniquePrimaryKeys?: boolean;
  skipDateUpdatedFields?: (keyof z.infer<T>)[];
  skipAuditLogFields?: (keyof z.infer<T>)[];
  readonlyFields?: (keyof z.infer<T>)[];
  additionalIndexes?: {
    fields: Partial<Record<IndexableFieldPath<z.infer<T>>, 1 | -1>>;
    unique?: boolean;
    sparse?: boolean;
    // Explicit index name (required for partial indexes so they can be matched
    // for removal and so dup-key errors can be identified).
    name?: string;
    // Build a partial index — only documents matching this filter are indexed.
    // Enables e.g. a unique constraint scoped to a subset of rows.
    partialFilterExpression?: Record<string, unknown>;
  }[];
  // NB: Names of indexes to remove
  indexesToRemove?: string[];
  baseQuery?: ScopedFilterQuery<T, PKey>;
  apiConfig?: ApiModelConfig<ApiT>;
  defaultValues?: DeepPartial<CreateProps<z.infer<T>>>;
}

// Global set to track which collections we've updated indexes for already
// We only need to update indexes once at server start-up
const indexesUpdated: Set<string> = new Set();

// Global map to track pending index operations
const pendingIndexOperations = new Map<string, Promise<string | void>[]>();

// Per-schema cache of top-level fields that accept undefined but reject null.
// Legacy writes serialized undefined as BSON null; reads strip those nulls so
// they look unset, without requiring a data migration.
const nullIntolerantOptionalFields = new WeakMap<object, ReadonlySet<string>>();

// Helper function to wait for all pending index operations to complete
export async function waitForIndexes(): Promise<void> {
  const allPromises: Promise<string | void>[] = [];
  for (const promises of pendingIndexOperations.values()) {
    allPromises.push(...promises);
  }
  await Promise.allSettled(allPromises);
  pendingIndexOperations.clear();
}

/**
 * Extracts the Zod schema type for a specific slot (paramsSchema/bodySchema/querySchema)
 * for a specific CRUD action from the model's crudValidatorOverrides type (CVO).
 * Falls back to DefaultCrudValidators when no override is defined for that action/slot,
 * preserving structural guarantees (e.g. params.id on delete/get/update).
 *
 * CVO is inferred from the concrete crudValidatorOverrides value passed to MakeModelClass,
 * so handleApi* override signatures in subclasses are automatically derived from the validators
 * without requiring explicit type annotations on the req parameter.
 */
type ExtractCrudSchema<
  CVO extends CrudValidatorOverrides,
  Action extends CrudAction,
  Slot extends "paramsSchema" | "bodySchema" | "querySchema",
> =
  CVO extends Record<Action, Record<Slot, infer Validator>>
    ? Validator extends z.ZodTypeAny
      ? Validator
      : DefaultCrudValidators[Action][Slot]
    : DefaultCrudValidators[Action][Slot];

// Thrown by `_updateOne` when a guarded write matches zero docs (the doc
// changed between read and write). Caught only by `updateWithCas` to retry.
class CasConflictError extends Error {
  constructor() {
    super("Compare-and-swap conflict");
    this.name = "CasConflictError";
  }
}

// Generic model class has everything but the actual data fetch implementation.
// See BaseModel below for the class with explicit mongodb implementation.
export abstract class BaseModel<
  T extends BaseSchemaWithPrimaryKey<PKey>,
  E extends EntityType,
  ApiT extends ApiBaseSchema,
  PKey extends z.ZodRawShape,
  WriteOptions = never,
  PK extends readonly string[] = readonly ["id"],
  CVO extends CrudValidatorOverrides = CrudValidatorOverrides,
> {
  public validator: T;
  public createValidator: CreateZodObject<T, PKey>;
  public updateValidator: UpdateZodObject<T, PKey, PK>;

  protected context: Context;
  protected config: ModelConfig<T, E, ApiT, PKey>;
  private _auditLogger: ReturnType<typeof createModelAuditLogger> | null;

  public constructor(context: Context) {
    this.context = context;
    this.config = this.getConfig();
    this.validator = this.config.schema;
    this.createValidator = this.getCreateValidator();
    this.updateValidator = this.getUpdateValidator();
    this._auditLogger = this.config.auditLog
      ? createModelAuditLogger(this.config.auditLog, (doc: object) =>
          this.getEntityId(doc as z.infer<T>),
        )
      : null;
    this.updateIndexes();
  }

  protected getPKey(): PKeyType<T, PKey> {
    return (this.config.pKey ?? DEFAULT_PKEY) as PKeyType<T, PKey>;
  }

  protected getPrimaryKeyFilter(doc: z.infer<T>) {
    const keys = this.getPKey();
    const filter = pick(doc, keys);
    for (const key of keys) {
      // With ignoreUndefined, an undefined key would be dropped from the
      // filter entirely, matching an arbitrary document in the org
      if ((filter as Record<string, unknown>)[key as string] === undefined) {
        throw new Error(
          `Missing primary key field "${String(key)}" on ${
            this.config.collectionName
          } document`,
        );
      }
    }
    return filter;
  }

  // String id for audit log entity (single key: value; composite: JSON)
  protected getEntityId(doc: z.infer<T>): string {
    const filter = this.getPrimaryKeyFilter(doc);
    const values = Object.values(filter);
    if (values.length === 1) return String(values[0]);
    return JSON.stringify(filter);
  }

  /***************
   * Required methods that MUST be overridden by subclasses
   ***************/
  protected abstract canRead(doc: z.infer<T>): boolean;
  protected abstract canCreate(doc: z.infer<T>): boolean;
  protected abstract canUpdate(
    existing: z.infer<T>,
    updates: PKeyUpdateProps<T, PKey, PK>,
    newDoc: z.infer<T>,
  ): boolean;
  protected abstract canDelete(existing: z.infer<T>): boolean;

  /***************
   * Optional methods that can be overridden by subclasses as needed
   ***************/
  protected useConfigFile(): boolean {
    return false;
  }
  protected hasPremiumFeature(): boolean {
    return true;
  }
  protected getConfigDocuments(): z.infer<T>[] {
    return [];
  }
  protected async filterByReadPermissions(
    docs: z.infer<T>[],
  ): Promise<z.infer<T>[]> {
    await this.populateForeignRefs(docs);

    const filtered: z.infer<T>[] = [];
    for (const doc of docs) {
      try {
        if (this.canRead(doc)) {
          filtered.push(doc);
        }
      } catch (e) {
        // Ignore errors when trying to read, just remove it from the list
      }
    }
    return filtered;
  }
  protected migrate(legacyDoc: unknown): z.infer<T> {
    return legacyDoc as z.infer<T>;
  }
  protected toApiInterface(doc: z.infer<T>): z.infer<ApiT> {
    return {
      ...doc,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
    } as z.infer<ApiT>;
  }
  protected async customValidation(
    doc: z.infer<T>,
    previousDoc?: z.infer<T>,
    writeOptions?: WriteOptions,
  ) {
    // Do nothing by default
  }
  protected async beforeCreate(doc: z.infer<T>, writeOptions?: WriteOptions) {
    // Do nothing by default
  }
  protected async afterCreate(doc: z.infer<T>, writeOptions?: WriteOptions) {
    // Do nothing by default
  }
  protected async beforeUpdate(
    existing: z.infer<T>,
    updates: PKeyUpdateProps<T, PKey, PK>,
    newDoc: z.infer<T>,
    writeOptions?: WriteOptions,
  ) {
    // Do nothing by default
  }
  protected async afterUpdate(
    existing: z.infer<T>,
    updates: PKeyUpdateProps<T, PKey, PK>,
    newDoc: z.infer<T>,
    writeOptions?: WriteOptions,
  ) {
    // Do nothing by default
  }
  protected async beforeDelete(doc: z.infer<T>, writeOptions?: WriteOptions) {
    // Do nothing by default
  }
  protected async afterDelete(doc: z.infer<T>, writeOptions?: WriteOptions) {
    // Do nothing by default
  }
  protected async afterCreateOrUpdate(
    doc: z.infer<T>,
    writeOptions?: WriteOptions,
  ) {
    // Do nothing by default
  }

  protected getForeignKeys(doc: z.infer<T>): ForeignKeys {
    const keys: ForeignKeys = {};

    // Experiment
    const experiment = this.detectForeignKey(doc, [
      "experiment",
      "experimentId",
    ]);
    if (experiment) {
      keys.experiment = experiment;
    }

    // Datasource
    const datasource = this.detectForeignKey(doc, [
      "datasource",
      "datasourceId",
    ]);
    if (datasource) {
      keys.datasource = datasource;
    }

    // Metric
    const metric = this.detectForeignKey(doc, ["metric", "metricId"]);
    if (metric) {
      keys.metric = metric;
    }

    const feature = this.detectForeignKey(doc, ["feature", "featureId"]);
    if (feature) {
      keys.feature = feature;
    }

    // Polymorphic entityType/entityId reference (e.g. ramp schedules)
    const entityId = this.detectForeignKey(doc, ["entityId"]);
    const entityType =
      "entityType" in doc &&
      typeof doc["entityType" as keyof z.infer<T>] === "string"
        ? (doc["entityType" as keyof z.infer<T>] as string)
        : undefined;
    if (
      entityId &&
      entityType &&
      (entityType === "experiment" ||
        entityType === "datasource" ||
        entityType === "metric" ||
        entityType === "feature") &&
      !keys[entityType]
    ) {
      keys[entityType] = entityId;
    }

    return keys;
  }

  public async handleApiGet(
    req: ApiRequest<
      unknown,
      ExtractCrudSchema<CVO, "get", "paramsSchema">,
      ExtractCrudSchema<CVO, "get", "bodySchema">,
      ExtractCrudSchema<CVO, "get", "querySchema">
    >,
  ): Promise<z.infer<ApiT>> {
    const { id } = req.params as { id: string };
    const doc = await this.getById(id);
    if (!doc) req.context.throwNotFoundError();
    return resolveOwnerEmail(this.toApiInterface(doc), this.context);
  }
  public async handleApiCreate(
    req: ApiRequest<
      unknown,
      ExtractCrudSchema<CVO, "create", "paramsSchema">,
      ExtractCrudSchema<CVO, "create", "bodySchema">,
      ExtractCrudSchema<CVO, "create", "querySchema">
    >,
  ): Promise<z.infer<ApiT>> {
    const rawBody = req.body;
    const toCreate = await this.processApiCreateBody(rawBody);
    return resolveOwnerEmail(
      this.toApiInterface(await this.create(toCreate)),
      this.context,
    );
  }
  protected async processApiCreateBody(
    rawBody: unknown,
  ): Promise<CreateProps<z.infer<T>>> {
    return rawBody as CreateProps<z.infer<T>>;
  }
  public async handleApiList(
    _req: ApiRequest<
      unknown,
      ExtractCrudSchema<CVO, "list", "paramsSchema">,
      ExtractCrudSchema<CVO, "list", "bodySchema">,
      ExtractCrudSchema<CVO, "list", "querySchema">
    >,
  ): Promise<z.infer<ApiT>[]> {
    return resolveOwnerEmails(
      (await this.getAll()).map((doc) => this.toApiInterface(doc)),
      this.context,
    );
  }
  public async handleApiDelete(
    req: ApiRequest<
      unknown,
      ExtractCrudSchema<CVO, "delete", "paramsSchema">,
      ExtractCrudSchema<CVO, "delete", "bodySchema">,
      ExtractCrudSchema<CVO, "delete", "querySchema">
    >,
  ): Promise<string> {
    const { id } = req.params as { id: string };
    await this.deleteById(id);
    return id;
  }
  public async handleApiUpdate(
    req: ApiRequest<
      unknown,
      ExtractCrudSchema<CVO, "update", "paramsSchema">,
      ExtractCrudSchema<CVO, "update", "bodySchema">,
      ExtractCrudSchema<CVO, "update", "querySchema">
    >,
  ): Promise<z.infer<ApiT>> {
    const { id } = req.params as { id: string };
    const rawBody = req.body;
    const toUpdate = await this.processApiUpdateBody(rawBody);
    return resolveOwnerEmail(
      this.toApiInterface(await this.updateById(id, toUpdate)),
      this.context,
    );
  }
  protected async processApiUpdateBody(
    rawBody: unknown,
  ): Promise<PKeyUpdateProps<T, PKey, PK>> {
    return rawBody as PKeyUpdateProps<T, PKey, PK>;
  }

  /***************
   * These methods are implemented by the MakeModelClass helper function
   ***************/
  protected abstract getConfig(): ModelConfig<T, E, ApiT, PKey>;
  protected abstract getCreateValidator(): CreateZodObject<T, PKey>;
  protected abstract getUpdateValidator(): UpdateZodObject<T, PKey, PK>;
  public static getModelConfig() {
    throw new Error("Method not implemented! Use derived class");
  }

  /***************
   * Built-in public methods
   ***************/
  public getById(id: string) {
    this._assertHasIdField();
    if (typeof id !== "string") {
      throw new Error("Invalid id");
    }
    if (!id) return Promise.resolve(null);

    return this._findOne({ id });
  }
  public getByIds(ids: string[]) {
    this._assertHasIdField();
    // Make sure ids is an array of strings
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new Error("Invalid ids");
    }
    if (!ids.length) return Promise.resolve([]);

    return this._find({ id: { $in: ids } });
  }
  public getAll() {
    return this._find();
  }
  public create(
    props: CreateProps<z.infer<T>>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    if (!this.hasPremiumFeature()) {
      throw new Error(
        "Your organization does not have access to this feature.",
      );
    }
    return this._createOne(props, writeOptions);
  }
  public dangerousCreateBypassPermission(
    props: CreateProps<z.infer<T>>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    return this._createOne(props, writeOptions, true);
  }
  // Undefined handling: passing `field: undefined` requests that the field
  // become absent. It's honored (as a $unset) only for fields whose schema
  // permits absence (.optional()/.nullish()); for fields that can't be
  // undefined (required, or .nullable() without .optional()) it's treated as
  // "no change" and ignored. Omitting a key entirely is always "no change". To
  // set a .nullable() field to null, pass `null`.
  public update(
    existing: z.infer<T>,
    updates: PKeyUpdateProps<T, PKey, PK>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    if (!this.hasPremiumFeature()) {
      throw new Error(
        "Your organization does not have access to this feature.",
      );
    }
    return this._updateOne(existing, updates, { writeOptions });
  }
  public async dangerousUpdateBypassPermission(
    existing: z.infer<T>,
    updates: PKeyUpdateProps<T, PKey, PK>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    return this._updateOne(existing, updates, {
      writeOptions,
      forceCanUpdate: true,
    });
  }
  public async dangerousUpdateByIdBypassPermission(
    id: string,
    updates: PKeyUpdateProps<T, PKey, PK>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    this._assertHasIdField();
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find resource to update");
    }
    return this._updateOne(existing, updates, {
      writeOptions,
      forceCanUpdate: true,
    });
  }
  public async updateById(
    id: string,
    updates: PKeyUpdateProps<T, PKey, PK>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    this._assertHasIdField();
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find resource to update");
    }
    return this._updateOne(existing, updates, { writeOptions });
  }
  /**
   * Compare-and-swap update for read-modify-write hotspots (e.g. reconciling a
   * denormalized status from an embedded array several writers touch at once).
   * Re-reads, runs `compute`, and writes only if `guardFields` are unchanged,
   * retrying up to `maxAttempts`. Application-level optimistic concurrency (no
   * transactions), so it stays DocumentDB/CosmosDB compatible.
   *
   * Goes through canRead + `_updateOne` (canUpdate, validation, audit, hooks),
   * which run only on the winning attempt — but `compute` may run several times,
   * so keep it side-effect free. Returns the updated doc, or null if the doc is
   * gone / not readable / `compute` aborts. Throws if attempts are exhausted.
   */
  public async updateWithCas(
    id: string,
    guardFields: (keyof z.infer<T>)[],
    compute: (
      existing: z.infer<T>,
    ) =>
      | PKeyUpdateProps<T, PKey, PK>
      | null
      | Promise<PKeyUpdateProps<T, PKey, PK> | null>,
    options: { maxAttempts?: number; writeOptions?: WriteOptions } = {},
  ): Promise<z.infer<T> | null> {
    this._assertHasIdField();
    if (!this.hasPremiumFeature()) {
      throw new Error(
        "Your organization does not have access to this feature.",
      );
    }
    const maxAttempts = options.maxAttempts ?? 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Read raw so guard + compute share one snapshot of the stored doc.
      const raw = (await this._dangerousGetCollection().findOne(
        this.applyBaseQuery({ id }),
      )) as Record<string, unknown> | null;
      if (!raw) return null;

      const existing = this._stripLegacyNullFields(
        this.migrate(this._removeMongooseFields(raw)) as z.infer<T>,
      );

      // Read gate mirrors getById/_findOne; canUpdate is enforced in _updateOne.
      await this.populateForeignRefs([existing]);
      if (!this.canRead(existing)) return null;

      const updates = await compute(existing);
      if (!updates) return null;

      const guard = Object.fromEntries(
        guardFields.map((f) => {
          const v = raw[f as string];
          return [f as string, v === undefined ? { $exists: false } : v];
        }),
      );

      try {
        return await this._updateOne(existing, updates, {
          writeOptions: options.writeOptions,
          guard,
        });
      } catch (e) {
        if (e instanceof CasConflictError) continue;
        throw e;
      }
    }
    throw new Error(
      `updateWithCas: exhausted ${maxAttempts} attempts for ${this.config.collectionName} ${id}`,
    );
  }
  public async delete(
    existing: z.infer<T>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T> | undefined> {
    await this._deleteOne(existing, writeOptions);
    return existing;
  }
  public async deleteById(
    id: string,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T> | undefined> {
    this._assertHasIdField();
    const existing = await this.getById(id);
    if (!existing) {
      // If it doesn't exist, maybe it was deleted already. No need to throw an error.
      return;
    }
    await this._deleteOne(existing, writeOptions);
    return existing;
  }

  /***************
   * Internal methods that can be used by subclasses
   ***************/
  protected _generateId() {
    return generateId(this.config.idPrefix);
  }
  protected _generateUid() {
    return uuidv4().replace(/-/g, "");
  }

  /**
   * Recursively applies default values to props, only setting values that are undefined.
   * Handles nested objects by merging them deeply.
   */
  protected _applyDefaultValues(
    props: Record<string, unknown>,
    defaults: Record<string, unknown>,
  ): void {
    for (const [key, defaultValue] of Object.entries(defaults)) {
      const currentValue = props[key];

      if (currentValue === undefined) {
        // If the value is undefined, apply the default
        props[key] = defaultValue;
      } else if (
        defaultValue !== null &&
        typeof defaultValue === "object" &&
        !Array.isArray(defaultValue) &&
        currentValue !== null &&
        typeof currentValue === "object" &&
        !Array.isArray(currentValue)
      ) {
        // If both are objects (not arrays), recursively merge nested defaults
        this._applyDefaultValues(
          currentValue as Record<string, unknown>,
          defaultValue as Record<string, unknown>,
        );
      }
    }
  }

  protected async _find(
    query: ScopedFilterQuery<T, PKey> = {},
    {
      sort,
      limit,
      skip,
      bypassReadPermissionChecks,
      bypassSanitization,
      projection,
      dangerousCrossOrganization,
    }: {
      sort?: Partial<{
        [key in keyof Omit<z.infer<T>, "organization">]: 1 | -1;
      }>;
      limit?: number;
      skip?: number;
      bypassReadPermissionChecks?: boolean;
      bypassSanitization?: boolean;
      // Note: projection does not work when using config.yml
      projection?: Partial<Record<keyof z.infer<T>, 0 | 1>>;
      dangerousCrossOrganization?: boolean;
    } = {},
  ) {
    const fullQuery = this.applyBaseQuery(query, dangerousCrossOrganization);
    let rawDocs;

    if (this.useConfigFile()) {
      const docs =
        this.getConfigDocuments().filter((doc) =>
          evalCondition(doc, fullQuery),
        ) || [];

      sort &&
        docs.sort((a, b) => {
          for (const key in sort) {
            const typedKey = key as keyof z.infer<T>;
            const sortDir = sort[typedKey] as 1 | -1;

            if (a[typedKey] < b[typedKey]) return -1 * sortDir;
            if (a[typedKey] > b[typedKey]) return 1 * sortDir;
          }
          return 0;
        });

      rawDocs = docs;
    } else {
      const cursor = this._dangerousGetCollection().find(fullQuery);
      if (projection) {
        cursor.project(projection);
      }
      sort &&
        cursor.sort(
          sort as {
            [key: string]: 1 | -1;
          },
        );
      rawDocs = await cursor.toArray();
    }

    if (!rawDocs.length) return [];

    const migrated = rawDocs.map((d) =>
      this._stripLegacyNullFields(this.migrate(this._removeMongooseFields(d))),
    );
    const filtered = bypassReadPermissionChecks
      ? migrated
      : await this.filterByReadPermissions(migrated);

    const paged =
      !skip && !limit
        ? filtered
        : filtered.slice(skip || 0, limit ? (skip || 0) + limit : undefined);

    return bypassSanitization ? paged : paged.map((doc) => this.sanitize(doc));
  }

  protected async _findOne(
    query: ScopedFilterQuery<T, PKey>,
    { bypassSanitization }: { bypassSanitization?: boolean } = {},
  ) {
    const fullQuery = this.applyBaseQuery(query);
    const doc = this.useConfigFile()
      ? this.getConfigDocuments().find((doc) => evalCondition(doc, fullQuery))
      : await this._dangerousGetCollection().findOne(fullQuery);
    if (!doc) return null;

    const migrated = this._stripLegacyNullFields(
      this.migrate(this._removeMongooseFields(doc)),
    );

    await this.populateForeignRefs([migrated]);
    if (!this.canRead(migrated)) {
      return null;
    }

    return bypassSanitization ? migrated : this.sanitize(migrated);
  }

  // Remove or transform any sensitive fields before returning to users
  protected sanitize(doc: z.infer<T>): z.infer<T> {
    return doc;
  }

  protected async _createOne(
    rawData: CreateProps<z.infer<T>>,
    writeOptions?: WriteOptions,
    forceCanCreate?: boolean,
  ) {
    // Apply default values BEFORE parsing to ensure required fields with defaults are populated
    const dataWithDefaults = { ...rawData };
    if (this.config.defaultValues) {
      this._applyDefaultValues(
        dataWithDefaults as Record<string, unknown>,
        this.config.defaultValues as Record<string, unknown>,
      );
    }

    const props = this.createValidator.parse(dataWithDefaults);

    if ("organization" in props) {
      throw new Error("Cannot set organization field");
    }
    if ("dateCreated" in props) {
      throw new Error("Cannot set dateCreated field");
    }
    if ("dateUpdated" in props) {
      throw new Error("Cannot set dateUpdated field");
    }

    // Resolve owner from email/name to userId if needed, then fall back to current user
    if ("owner" in props) {
      if (typeof props.owner === "string" && props.owner) {
        props.owner = await resolveOwnerToUserId(props.owner, this.context);
      }
      if (!props.owner) {
        props.owner = this.context.userId || "";
      }
    }

    if ("createdBy" in props && !props.createdBy) {
      props.createdBy = this.context.userName || "";
    }

    const generatedIds: Record<string, string> = {};
    if ("id" in this.config.schema.shape) {
      generatedIds.id = this._generateId();
    }
    if ("uid" in this.config.schema.shape) {
      generatedIds.uid = this._generateUid();
    }

    let doc = {
      ...generatedIds,
      ...props,
      organization: this.context.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    } as z.infer<T>;

    await this.populateForeignRefs([doc]);
    if (!forceCanCreate && !this.canCreate(doc)) {
      throw new Error("You do not have access to create this resource");
    }

    await this.validateProjectFields(doc);
    await this.customValidation(doc, undefined, writeOptions);

    if (this.useConfigFile()) {
      throw new Error(
        `Cannot create - ${this.config.collectionName} are being managed by config.yml`,
      );
    }

    await this.beforeCreate(doc, writeOptions);

    // insertOne mutates `doc` in place to add Mongo's `_id`. Scrub it (and the
    // mongoose version key) with the same helper reads use, so these internals
    // don't leak into the return value, audit log details, or hooks.
    await this._dangerousGetCollection().insertOne(doc, {
      ignoreUndefined: true,
    });
    doc = this._removeMongooseFields(doc) as z.infer<T>;

    if (this._auditLogger) {
      await this._auditLogger.logCreate(this.context, doc);
    }

    await this.afterCreate(doc, writeOptions);
    await this.afterCreateOrUpdate(doc, writeOptions);

    // Add tags if needed
    if ("tags" in doc && Array.isArray(doc.tags)) {
      await this.context.registerTags(doc.tags);
    }

    return doc;
  }

  protected async _updateOne(
    doc: z.infer<T>,
    updates: PKeyUpdateProps<T, PKey, PK>,
    options?: {
      auditEvent?: EventType;
      writeOptions?: WriteOptions;
      forceCanUpdate?: boolean;
      // CAS guard: write only applies if the doc still matches these field
      // values, else throws CasConflictError. Set via `updateWithCas`.
      guard?: Record<string, unknown>;
    },
  ) {
    updates = this.updateValidator.parse(updates);

    // Resolve owner from email to userId if needed
    if (
      "owner" in updates &&
      typeof updates.owner === "string" &&
      updates.owner
    ) {
      updates.owner = await resolveOwnerToUserId(updates.owner, this.context);
    }

    // An explicit `undefined` requests that a field become absent. This is
    // honored only where the schema permits absence (.optional()/.nullish()),
    // where it becomes a $unset below. For a field that can't be undefined
    // (required, or .nullable() without .optional()) absence is impossible, so
    // the undefined is treated as "no change" and dropped rather than erroring
    // — matching how ORMs ignore undefined, and sparing partial-update
    // call-sites that spread possibly-undefined values. To clear a .nullable()
    // field to null, pass `null` explicitly. Dropped before the diff so the key
    // never reaches newDoc or the write, keeping the returned doc equal to a
    // subsequent read.
    dropNonClearableUndefined(
      this.config.schema,
      updates as Record<string, unknown>,
    );

    // Only consider updates that actually change the value
    const updatedFields = Object.entries(updates)
      .filter(([k, v]) => !isEqual(doc[k as keyof z.infer<T>], v))
      .map(([k]) => k) as (keyof z.infer<T>)[];
    updates = pick(updates, updatedFields);

    // If no updates are needed, return immediately
    if (!updatedFields.length) {
      return doc;
    }

    // Make sure the updates don't include any fields that shouldn't be updated
    if (
      ["id", "uid", "organization", "dateCreated", "dateUpdated"].some(
        (k) => k in updates,
      )
    ) {
      throw new Error(
        "Cannot update id, uid, organization, dateCreated, or dateUpdated",
      );
    }

    if (this.config.readonlyFields) {
      const readonlyFields = new Set(this.config.readonlyFields);
      if (updatedFields.some((field) => readonlyFields.has(field))) {
        throw new Error(
          "Cannot update readonly fields: " + [...readonlyFields].join(", "),
        );
      }
    }

    // Only set dateUpdated if at least one important field has changed
    const setDateUpdated = updatedFields.some(
      (field) => !this.config.skipDateUpdatedFields?.includes(field),
    );

    const allUpdates = {
      ...updates,
      ...(setDateUpdated ? { dateUpdated: new Date() } : null),
    };

    const newDoc = { ...doc, ...allUpdates } as z.infer<T>;

    await this.populateForeignRefs([newDoc]);

    if (!options?.forceCanUpdate && !this.canUpdate(doc, updates, newDoc)) {
      throw new Error("You do not have access to update this resource");
    }

    await this.validateProjectFields(updates as Partial<z.infer<T>>);

    if (this.useConfigFile()) {
      throw new Error(
        `Cannot update - ${this.config.collectionName} are being managed by config.yml`,
      );
    }

    await this.beforeUpdate(doc, updates, newDoc, options?.writeOptions);

    await this.customValidation(newDoc, doc, options?.writeOptions);

    const writeResult = await this._dangerousGetCollection().updateOne(
      {
        ...this.getPrimaryKeyFilter(doc),
        organization: this.context.org.id,
        ...(options?.guard ?? {}),
      },
      translateUndefinedSetToUnset({ $set: allUpdates }),
      { ignoreUndefined: true },
    );

    // CAS miss: guarded fields changed since the read. Bail before audit/hooks
    // so the lost race is a true no-op.
    if (options?.guard && writeResult.matchedCount === 0) {
      throw new CasConflictError();
    }

    // Skip audit logging if only operational fields are being updated
    const shouldSkipAuditLog =
      this.config.skipAuditLogFields &&
      updatedFields.every((field) =>
        this.config.skipAuditLogFields?.includes(field),
      );

    if (this._auditLogger && !shouldSkipAuditLog) {
      await this._auditLogger.logUpdate(
        this.context,
        doc,
        newDoc,
        options?.auditEvent,
      );
    }

    await this.afterUpdate(doc, updates, newDoc, options?.writeOptions);
    await this.afterCreateOrUpdate(newDoc, options?.writeOptions);

    // Update tags if needed
    if ("tags" in newDoc && Array.isArray(newDoc.tags)) {
      await this.context.registerTags(newDoc.tags);
    }

    return newDoc;
  }

  protected async _dangerousCountDocumentsCrossOrganization(
    filter: ScopedFilterQuery<T, PKey>,
  ) {
    return this._dangerousGetCollection().countDocuments(filter);
  }

  protected async _countDocuments(filter: ScopedFilterQuery<T, PKey>) {
    const query = this.applyBaseQuery(filter);
    return this._dangerousGetCollection().countDocuments(query);
  }

  protected async _dangerousBulkWriteCrossOrganization(
    operations: AnyBulkWriteOperation[],
  ) {
    return dbSafeBulkWrite(this._dangerousGetCollection(), operations, {
      ignoreUndefined: true,
    });
  }

  protected async bulkWrite(operations: AnyBulkWriteOperation[]) {
    return dbSafeBulkWrite(
      this._dangerousGetCollection(),
      operations.map((op) => {
        if ("insertOne" in op) {
          return {
            insertOne: {
              ...op.insertOne,
              document: {
                ...op.insertOne.document,
                organization: this.context.org.id,
              },
            },
          };
        } else if ("updateOne" in op) {
          const filter = this.applyBaseQuery(op.updateOne.filter);
          // With ignoreUndefined, an undefined value would be dropped from
          // the filter entirely, broadening which documents match
          if (Object.values(filter).some((v) => v === undefined)) {
            throw new Error(
              "bulkWrite updateOne filter must not contain undefined values",
            );
          }
          return {
            updateOne: {
              ...op.updateOne,
              filter,
              update: Array.isArray(op.updateOne.update)
                ? op.updateOne.update
                : normalizeUpdateOneDocument(
                    this.config.schema,
                    op.updateOne.update,
                  ),
            },
          };
        }
        return this.context.throwInternalServerError(
          "Unsupported bulkWrite operation type in BaseModel#bulkWrite",
        );
      }),
      { ignoreUndefined: true },
    );
  }

  protected async _deleteOne(doc: z.infer<T>, writeOptions?: WriteOptions) {
    if (!this.canDelete(doc)) {
      throw new Error("You do not have access to delete this resource");
    }

    if (this.useConfigFile()) {
      throw new Error(
        `Cannot delete - ${this.config.collectionName} are being managed by config.yml`,
      );
    }
    await this.beforeDelete(doc, writeOptions);
    await this._dangerousGetCollection().deleteOne({
      ...this.getPrimaryKeyFilter(doc),
      organization: this.context.org.id,
    });

    if (this._auditLogger) {
      await this._auditLogger.logDelete(this.context, doc);
    }

    await this.afterDelete(doc, writeOptions);
  }

  protected detectForeignKey(
    doc: z.infer<T>,
    potentialFields: string[],
  ): string | null {
    for (const field of potentialFields) {
      if (
        field in doc &&
        doc[field as keyof z.infer<T>] &&
        typeof doc[field as keyof z.infer<T>] === "string"
      ) {
        return doc[field as keyof z.infer<T>] as string;
      }
    }
    return null;
  }

  protected getForeignRefs(
    doc: z.infer<T>,
    throwIfMissing: boolean = true,
  ): ForeignRefs {
    const refs = this.context.foreignRefs;
    const keys = this.getForeignKeys(doc);

    const result: ForeignRefs = {};
    for (const refType in keys) {
      const type = refType as keyof ForeignKeys;
      if (!keys[type]) continue;
      const value = refs[type]?.get(keys[type] || "");

      if (!value) {
        if (throwIfMissing) {
          throw new Error(
            `Could not find foreign ref for ${type}: ${keys[type]}`,
          );
        } else {
          continue;
        }
      }

      // eslint-disable-next-line
      result[type] = value as any;
    }

    return result;
  }

  private _collection: Collection | null = null;
  protected _dangerousGetCollection() {
    if (!this._collection) {
      // TODO: don't use Mongoose, use the native Mongo Driver instead
      this._collection = mongoose.connection.db.collection(
        this.config.collectionName,
      );
    }
    return this._collection;
  }

  protected async populateForeignRefs(docs: z.infer<T>[]) {
    // Merge all docs foreign keys into a single object
    const mergedKeys: ForeignRefsCacheKeys = {};

    docs.forEach((doc) => {
      const foreignKeys = this.getForeignKeys(doc);
      (Object.entries(foreignKeys) as [keyof ForeignKeys, string][]).forEach(
        ([type, id]) => {
          mergedKeys[type] = mergedKeys[type] || [];
          mergedKeys[type]?.push(id);
        },
      );
    });

    await this.context.populateForeignRefs(mergedKeys);
  }
  protected updateIndexes() {
    if (indexesUpdated.has(this.config.collectionName)) return;
    indexesUpdated.add(this.config.collectionName);

    const promises = [];

    const pKey = this.getPKey();
    const pKeyIndex = pKey.reduce<Record<string, 1>>(
      (acc, k) => ({ ...acc, [String(k)]: 1 as const }),
      {},
    );
    const orgPKeyIndex: Record<string, 1> = {
      ...pKeyIndex,
      organization: 1,
    };

    // Always create a unique index for organization and primary key
    promises.push(
      this._dangerousGetCollection()
        .createIndex(orgPKeyIndex, { unique: true })
        .catch((err) => {
          logger.error(
            err,
            `Error creating org/pKey unique index for ${this.config.collectionName}`,
          );
        }),
    );

    // If primary key is globally unique, create an index for that
    if (this.config.globallyUniquePrimaryKeys) {
      promises.push(
        this._dangerousGetCollection()
          .createIndex(pKeyIndex, { unique: true })
          .catch((err) => {
            logger.error(
              err,
              `Error creating unique pKey index for ${this.config.collectionName}`,
            );
          }),
      );
    }

    // If schema uses uid, create a globally unique index
    if ("uid" in this.config.schema.shape) {
      promises.push(
        this._dangerousGetCollection()
          .createIndex({ uid: 1 }, { unique: true })
          .catch((err) => {
            logger.error(
              err,
              `Error creating uid unique index for ${this.config.collectionName}`,
            );
          }),
      );
    }

    // Remove any explicitly defined indexes that are no longer needed
    const indexesToRemove = this.config.indexesToRemove;
    if (indexesToRemove && indexesToRemove.length > 0) {
      // Drop each index that needs to be removed
      indexesToRemove.forEach((indexName) => {
        promises.push(
          this._dangerousGetCollection()
            .dropIndex(indexName)
            .catch((err) => {
              // Ignore errors if the index or namespace doesn't exist
              if (
                err.codeName !== "IndexNotFound" &&
                err.codeName !== "NamespaceNotFound"
              ) {
                logger.error(
                  err,
                  `Error dropping index ${indexName} for ${this.config.collectionName}`,
                );
              }
            }),
        );
      });
    }

    // Create any additional indexes
    this.config.additionalIndexes?.forEach((index) => {
      promises.push(
        this._dangerousGetCollection()
          .createIndex(index.fields as { [key: string]: number }, {
            unique: !!index.unique,
            sparse: !!index.sparse,
            ...(index.name ? { name: index.name } : {}),
            ...(index.partialFilterExpression
              ? { partialFilterExpression: index.partialFilterExpression }
              : {}),
          })
          .catch((err) => {
            logger.error(
              err,
              `Error creating ${Object.keys(index.fields).join("/")} ${
                index.unique ? "unique " : ""
              }index for ${this.config.collectionName}`,
            );
          }),
      );
    });

    // Store the promises so they can be awaited externally
    pendingIndexOperations.set(this.config.collectionName, promises);
  }

  /***************
   * Private methods
   ***************/

  private _assertHasIdField(): void {
    if (!("id" in this.config.schema.shape)) {
      throw new Error(
        `getById/getByIds is not supported on "${this.config.collectionName}": schema has no "id" field. ` +
          `Use a model-specific accessor instead.`,
      );
    }
  }

  // Make sure any project ids in this model point to actual projects
  // This is only called when creating/updating to avoid breaking on read
  private async validateProjectFields(obj: Partial<z.infer<T>>) {
    // Resources with a single project
    if ("project" in obj && obj.project && typeof obj.project === "string") {
      const projects = await this.context.getProjects();
      if (!projects.some((p) => p.id === obj.project)) {
        throw new Error("Invalid project");
      }
    }
    // Resources with multiple projects
    else if ("projects" in obj && obj.projects && Array.isArray(obj.projects)) {
      const projects = await this.context.getProjects();
      if (
        !obj.projects.every((p: string) =>
          projects.some((proj) => proj.id === p),
        )
      ) {
        throw new Error("Invalid project");
      }
    }
  }

  private getBaseQuery(): ScopedFilterQuery<T, PKey> {
    return this.config.baseQuery ?? {};
  }

  private applyBaseQuery(
    filter: object,
    dangerousCrossOrganization: boolean = false,
  ): FilterQuery<z.infer<T>> {
    const fullQuery: FilterQuery<z.infer<T>> = {
      ...this.getBaseQuery(),
      ...filter,
    };
    if (!dangerousCrossOrganization) {
      fullQuery.organization = this.context.org.id;
    }
    return fullQuery;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _removeMongooseFields(doc: any) {
    return omit(doc, ["__v", "_id"]) as unknown;
  }

  private _getNullIntolerantOptionalFields(): ReadonlySet<string> {
    const cached = nullIntolerantOptionalFields.get(this.config.schema);
    if (cached) return cached;
    const fields = new Set<string>();
    for (const [key, fieldSchema] of Object.entries(this.config.schema.shape)) {
      if (
        !z.safeParse(fieldSchema, null).success &&
        z.safeParse(fieldSchema, undefined).success
      ) {
        fields.add(key);
      }
    }
    nullIntolerantOptionalFields.set(this.config.schema, fields);
    return fields;
  }

  // Mutates in place: doc is always a fresh copy from _removeMongooseFields
  private _stripLegacyNullFields(doc: z.infer<T>): z.infer<T> {
    for (const key of this._getNullIntolerantOptionalFields()) {
      if ((doc as Record<string, unknown>)[key] === null) {
        delete (doc as Record<string, unknown>)[key];
      }
    }
    return doc;
  }
}

/**
 * Merges body schemas from openApiSpec.schemas into the CVO type so that
 * ExtractCrudSchema can resolve the correct body type for create/update
 * handler overrides — even when the schemas are not in crudValidatorOverrides.
 */
type MergedCrudOverrides<
  CVO extends CrudValidatorOverrides,
  CB extends z.ZodTypeAny,
  UB extends z.ZodTypeAny,
> = CVO & {
  create: { bodySchema: CB };
  update: { bodySchema: UB };
};

export const MakeModelClass = <
  T extends BaseSchemaWithPrimaryKey<PKey>,
  E extends EntityType,
  ApiT extends ApiBaseSchema,
  PKey extends z.ZodRawShape,
  PK extends readonly string[] = typeof DEFAULT_PKEY,
  CVO extends CrudValidatorOverrides = CrudValidatorOverrides,
  CB extends z.ZodTypeAny = z.ZodUnknown,
  UB extends z.ZodTypeAny = z.ZodUnknown,
>(
  config: ModelConfig<T, E, ApiT, PKey> & {
    apiConfig?: {
      openApiSpec?: {
        crudValidatorOverrides?: CVO;
        schemas?: { createBody?: CB; updateBody?: UB };
      };
    };
  } & { pKey?: PK },
) => {
  const createValidator = createSchema<T, PKey>(config.schema);
  const updateValidator = updateSchema<T, PKey>(
    config.schema,
    config.pKey as PKeyType<T, PKey> | undefined,
  ) as UpdateZodObject<T, PKey, PK>;

  abstract class Model<WriteOptions = never> extends BaseModel<
    T,
    E,
    ApiT,
    PKey,
    WriteOptions,
    PK,
    MergedCrudOverrides<CVO, CB, UB>
  > {
    getConfig() {
      return config as ModelConfig<T, E, ApiT, PKey>;
    }
    static getModelConfig(): ModelConfig<T, E, ApiT, PKey> {
      return config as ModelConfig<T, E, ApiT, PKey>;
    }
    getCreateValidator() {
      return createValidator;
    }
    getUpdateValidator() {
      return updateValidator;
    }
  }

  return Model;
};
