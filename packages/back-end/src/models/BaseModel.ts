/* eslint-disable @typescript-eslint/no-unused-vars */

import { v4 as uuidv4 } from "uuid";
import uniqid from "uniqid";
import mongoose, { FilterQuery } from "mongoose";
import { Collection } from "mongodb";
import omit from "lodash/omit";
import { z } from "zod";
import { isEqual, pick } from "lodash";
import { evalCondition } from "@growthbook/growthbook";
import { baseSchema } from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import {
  AuditInterfaceTemplate,
  EntityType,
  EventTypes,
  EventType,
} from "shared/types/audit";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import {
  ForeignKeys,
  ForeignRefs,
  ForeignRefsCacheKeys,
} from "back-end/src/services/context";
import { ApiRequest } from "back-end/src/util/handler";
import { ApiBaseSchema, ApiModelConfig } from "back-end/src/api/ApiModel";

export type Context = ApiReqContext | ReqContext;

export type BaseSchema = typeof baseSchema;

export type ScopedFilterQuery<T extends BaseSchema> = FilterQuery<
  Omit<z.infer<T>, "organization">
>;

export type CreateZodObject<T extends BaseSchema> = z.ZodType<
  CreateProps<z.infer<T>>
>;

export const createSchema = <T extends BaseSchema>(schema: T) =>
  schema
    .omit({
      organization: true,
      dateCreated: true,
      dateUpdated: true,
    })
    .extend({ id: z.string().optional(), uid: z.string().optional() })
    .strict() as unknown as CreateZodObject<T>;

export type UpdateZodObject<T extends BaseSchema> = z.ZodType<
  UpdateProps<z.infer<T>>
>;

type Identifiers = {
  id: string;
  uid?: string;
};

const updateSchema = <T extends BaseSchema>(schema: T) =>
  schema
    .omit({
      id: true,
      organization: true,
      dateCreated: true,
      dateUpdated: true,
    })
    .partial()
    .strict() as unknown as UpdateZodObject<T>;

type AuditLogConfig<Entity extends EntityType> = {
  entity: Entity;
  createEvent: EventTypes<Entity>;
  updateEvent: EventTypes<Entity>;
  deleteEvent: EventTypes<Entity>;
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

export interface ModelConfig<
  T extends BaseSchema,
  Entity extends EntityType,
  ApiT extends ApiBaseSchema,
> {
  schema: T;
  collectionName: string;
  idPrefix?: string;
  auditLog?: AuditLogConfig<Entity>;
  globallyUniqueIds?: boolean;
  skipDateUpdatedFields?: (keyof z.infer<T>)[];
  readonlyFields?: (keyof z.infer<T>)[];
  additionalIndexes?: {
    fields: Partial<{
      [key in keyof z.infer<T>]: 1 | -1;
    }>;
    unique?: boolean;
  }[];
  // NB: Names of indexes to remove
  indexesToRemove?: string[];
  baseQuery?: ScopedFilterQuery<T>;
  apiConfig?: ApiModelConfig<ApiT>;
  defaultValues?: DeepPartial<CreateProps<z.infer<T>>>;
}

// Global set to track which collections we've updated indexes for already
// We only need to update indexes once at server start-up
const indexesUpdated: Set<string> = new Set();

// Generic model class has everything but the actual data fetch implementation.
// See BaseModel below for the class with explicit mongodb implementation.
export abstract class BaseModel<
  T extends BaseSchema,
  E extends EntityType,
  ApiT extends ApiBaseSchema,
  WriteOptions = never,
> {
  public validator: T;
  public createValidator: CreateZodObject<T>;
  public updateValidator: UpdateZodObject<T>;

  protected context: Context;
  protected config: ModelConfig<T, E, ApiT>;

  public constructor(context: Context) {
    this.context = context;
    this.config = this.getConfig();
    this.validator = this.config.schema;
    this.createValidator = this.getCreateValidator();
    this.updateValidator = this.getUpdateValidator();
    this.updateIndexes();
  }

  /***************
   * Required methods that MUST be overridden by subclasses
   ***************/
  protected abstract canRead(doc: z.infer<T>): boolean;
  protected abstract canCreate(doc: z.infer<T>): boolean;
  protected abstract canUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
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
    updates: UpdateProps<z.infer<T>>,
    newDoc: z.infer<T>,
    writeOptions?: WriteOptions,
  ) {
    // Do nothing by default
  }
  protected async afterUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
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

    return keys;
  }

  public async handleApiGet(
    req: ApiRequest<
      unknown,
      z.ZodType<{ id: string }>,
      z.ZodTypeAny,
      z.ZodTypeAny
    >,
  ): Promise<z.infer<ApiT>> {
    const id = req.params.id;
    const doc = await this.getById(id);
    if (!doc) req.context.throwNotFoundError();
    return this.toApiInterface(doc);
  }
  public async handleApiCreate(
    req: ApiRequest<unknown, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  ): Promise<z.infer<ApiT>> {
    const rawBody = req.body;
    const toCreate = await this.processApiCreateBody(rawBody);
    return this.toApiInterface(await this.create(toCreate));
  }
  protected async processApiCreateBody(
    rawBody: unknown,
  ): Promise<CreateProps<z.infer<T>>> {
    return rawBody as CreateProps<z.infer<T>>;
  }
  public async handleApiList(
    _req: ApiRequest<unknown, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  ): Promise<z.infer<ApiT>[]> {
    return (await this.getAll()).map(this.toApiInterface);
  }
  public async handleApiDelete(
    req: ApiRequest<
      unknown,
      z.ZodType<{ id: string }>,
      z.ZodTypeAny,
      z.ZodTypeAny
    >,
  ): Promise<string> {
    const id = req.params.id;
    await this.deleteById(id);
    return id;
  }
  public async handleApiUpdate(
    req: ApiRequest<
      unknown,
      z.ZodType<{ id: string }>,
      z.ZodType<UpdateProps<z.infer<T>>>,
      z.ZodTypeAny
    >,
  ): Promise<z.infer<ApiT> | void> {
    const id = req.params.id;
    const rawBody = req.body;
    const toUpdate = await this.processApiUpdateBody(rawBody);
    return this.toApiInterface(await this.updateById(id, toUpdate));
  }
  protected async processApiUpdateBody(
    rawBody: unknown,
  ): Promise<UpdateProps<z.infer<T>>> {
    return rawBody as UpdateProps<z.infer<T>>;
  }

  /***************
   * These methods are implemented by the MakeModelClass helper function
   ***************/
  protected abstract getConfig(): ModelConfig<T, E, ApiT>;
  protected abstract getCreateValidator(): CreateZodObject<T>;
  protected abstract getUpdateValidator(): UpdateZodObject<T>;
  public static getModelConfig() {
    throw new Error("Method not implemented! Use derived class");
  }

  /***************
   * Built-in public methods
   ***************/
  public getById(id: string) {
    if (typeof id !== "string") {
      throw new Error("Invalid id");
    }
    if (!id) return Promise.resolve(null);

    return this._findOne({ id });
  }
  public getByIds(ids: string[]) {
    // Make sure ids is an array of strings
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new Error("Invalid ids");
    }
    if (!ids.length) return Promise.resolve([]);

    return this._find({ id: { $in: ids } });
  }
  public getAll(filter?: ScopedFilterQuery<T>) {
    return this._find(filter);
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
  public update(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
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
    updates: UpdateProps<z.infer<T>>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    return this._updateOne(existing, updates, {
      writeOptions,
      forceCanUpdate: true,
    });
  }
  public async dangerousUpdateByIdBypassPermission(
    id: string,
    updates: UpdateProps<z.infer<T>>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
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
    updates: UpdateProps<z.infer<T>>,
    writeOptions?: WriteOptions,
  ): Promise<z.infer<T>> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find resource to update");
    }
    return this._updateOne(existing, updates, { writeOptions });
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
    return uniqid(this.config.idPrefix);
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
    query: ScopedFilterQuery<T> = {},
    {
      sort,
      limit,
      skip,
      bypassReadPermissionChecks,
      projection,
    }: {
      sort?: Partial<{
        [key in keyof Omit<z.infer<T>, "organization">]: 1 | -1;
      }>;
      limit?: number;
      skip?: number;
      bypassReadPermissionChecks?: boolean;
      // Note: projection does not work when using config.yml
      projection?: Partial<Record<keyof z.infer<T>, 0 | 1>>;
    } = {},
  ) {
    const fullQuery = {
      ...this.getBaseQuery(),
      ...query,
      organization: this.context.org.id,
    };
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
      this.migrate(this._removeMongooseFields(d)),
    );
    const filtered = bypassReadPermissionChecks
      ? migrated
      : await this.filterByReadPermissions(migrated);

    if (!skip && !limit) return filtered;

    return filtered.slice(skip || 0, limit ? (skip || 0) + limit : undefined);
  }

  protected async _findOne(query: ScopedFilterQuery<T>) {
    const fullQuery = {
      ...this.getBaseQuery(),
      ...query,
      organization: this.context.org.id,
    };
    const doc = this.useConfigFile()
      ? this.getConfigDocuments().find((doc) => evalCondition(doc, fullQuery))
      : await this._dangerousGetCollection().findOne(fullQuery);
    if (!doc) return null;

    const migrated = this.migrate(this._removeMongooseFields(doc));

    await this.populateForeignRefs([migrated]);
    if (!this.canRead(migrated)) {
      return null;
    }

    return migrated;
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

    // Add default owner if empty
    if ("owner" in props && !props.owner) {
      props.owner = this.context.userName || "";
    }

    const ids: Identifiers = {
      id: this._generateId(),
    };
    if ("uid" in this.config.schema.shape) {
      ids.uid = this._generateUid();
    }

    const doc = {
      ...ids,
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
    await this.customValidation(doc, writeOptions);

    if (this.useConfigFile()) {
      throw new Error(
        `Cannot create - ${this.config.collectionName} are being managed by config.yml`,
      );
    }

    await this.beforeCreate(doc, writeOptions);

    await this._dangerousGetCollection().insertOne(doc);

    if (this.config.auditLog) {
      try {
        await this.context.auditLog({
          entity: {
            object: this.config.auditLog.entity,
            id: doc.id,
            name:
              ("name" in doc && typeof doc.name === "string" && doc.name) || "",
          },
          event: this.config.auditLog.createEvent,
          details: auditDetailsCreate(doc),
        } as AuditInterfaceTemplate<E>);
      } catch (e) {
        this.context.logger.error(
          e,
          `Error creating audit log for ${this.config.auditLog.createEvent}`,
        );
      }
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
    updates: UpdateProps<z.infer<T>>,
    options?: {
      auditEvent?: EventType;
      writeOptions?: WriteOptions;
      forceCanUpdate?: boolean;
    },
  ) {
    updates = this.updateValidator.parse(updates);

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
      ["id", "organization", "dateCreated", "dateUpdated"].some(
        (k) => k in updates,
      )
    ) {
      throw new Error(
        "Cannot update id, organization, dateCreated, or dateUpdated",
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

    await this.customValidation(newDoc, options?.writeOptions);

    await this._dangerousGetCollection().updateOne(
      {
        organization: this.context.org.id,
        id: doc.id || "",
      },
      {
        $set: allUpdates,
      },
    );

    const auditEvent = options?.auditEvent || this.config.auditLog?.updateEvent;
    if (this.config.auditLog) {
      try {
        await this.context.auditLog({
          entity: {
            object: this.config.auditLog.entity,
            id: doc.id,
            name:
              ("name" in newDoc &&
                typeof newDoc.name === "string" &&
                newDoc.name) ||
              "",
          },
          event: auditEvent,
          details: auditDetailsUpdate(doc, newDoc),
        } as AuditInterfaceTemplate<E>);
      } catch (e) {
        this.context.logger.error(
          e,
          `Error creating audit log for ${auditEvent}`,
        );
      }
    }

    await this.afterUpdate(doc, updates, newDoc, options?.writeOptions);
    await this.afterCreateOrUpdate(newDoc, options?.writeOptions);

    // Update tags if needed
    if ("tags" in newDoc && Array.isArray(newDoc.tags)) {
      await this.context.registerTags(newDoc.tags);
    }

    return newDoc;
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
      organization: this.context.org.id,
      id: doc.id,
    });

    if (this.config.auditLog) {
      try {
        await this.context.auditLog({
          entity: {
            object: this.config.auditLog.entity,
            id: doc.id,
            name:
              ("name" in doc && typeof doc.name === "string" && doc.name) || "",
          },
          event: this.config.auditLog.deleteEvent,
          details: auditDetailsDelete(doc),
        } as AuditInterfaceTemplate<E>);
      } catch (e) {
        this.context.logger.error(
          e,
          `Error creating audit log for ${this.config.auditLog.deleteEvent}`,
        );
      }
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
      Object.entries(foreignKeys).forEach(
        ([type, id]: [keyof ForeignKeys, string]) => {
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

    // Always create a unique index for organization and id
    this._dangerousGetCollection()
      .createIndex({ id: 1, organization: 1 }, { unique: true })
      .catch((err) => {
        logger.error(
          err,
          `Error creating org/id unique index for ${this.config.collectionName}`,
        );
      });

    // If id is globally unique, create an index for that
    if (this.config.globallyUniqueIds) {
      this._dangerousGetCollection()
        .createIndex({ id: 1 }, { unique: true })
        .catch((err) => {
          logger.error(
            err,
            `Error creating id unique index for ${this.config.collectionName}`,
          );
        });
    }

    // If schema uses uid, create a globally unique index
    if ("uid" in this.config.schema.shape) {
      this._dangerousGetCollection()
        .createIndex({ uid: 1 }, { unique: true })
        .catch((err) => {
          logger.error(
            err,
            `Error creating uid unique index for ${this.config.collectionName}`,
          );
        });
    }

    // Remove any explicitly defined indexes that are no longer needed
    const indexesToRemove = this.config.indexesToRemove;
    if (indexesToRemove) {
      const existingIndexes = this._dangerousGetCollection().listIndexes();
      existingIndexes.forEach((index) => {
        if (!indexesToRemove.includes(index.name)) return;

        this._dangerousGetCollection()
          .dropIndex(index.name)
          .catch((err) => {
            logger.error(
              err,
              `Error dropping index ${index.name} for ${this.config.collectionName}`,
            );
          });
      });
    }

    // Create any additional indexes
    this.config.additionalIndexes?.forEach((index) => {
      this._dangerousGetCollection()
        .createIndex(index.fields as { [key: string]: number }, {
          unique: !!index.unique,
        })
        .catch((err) => {
          logger.error(
            err,
            `Error creating ${Object.keys(index.fields).join("/")} ${
              index.unique ? "unique " : ""
            }index for ${this.config.collectionName}`,
          );
        });
    });
  }

  /***************
   * Private methods
   ***************/

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

  private getBaseQuery(): ScopedFilterQuery<T> {
    return this.config.baseQuery ?? {};
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _removeMongooseFields(doc: any) {
    return omit(doc, ["__v", "_id"]) as unknown;
  }
}

export const MakeModelClass = <
  T extends BaseSchema,
  E extends EntityType,
  ApiT extends ApiBaseSchema,
>(
  config: ModelConfig<T, E, ApiT>,
) => {
  const createValidator = createSchema(config.schema);
  const updateValidator = updateSchema(config.schema);

  abstract class Model<WriteOptions = never> extends BaseModel<
    T,
    E,
    ApiT,
    WriteOptions
  > {
    getConfig() {
      return config;
    }
    static getModelConfig(): ModelConfig<T, E, ApiT> {
      return config;
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
