/* eslint-disable @typescript-eslint/no-unused-vars */

import uniqid from "uniqid";
import mongoose, { FilterQuery } from "mongoose";
import { Collection } from "mongodb";
import omit from "lodash/omit";
import { z } from "zod";
import { isEqual, orderBy, pick } from "lodash";
import { evalCondition } from "@growthbook/growthbook";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/organization";
import { logger } from "back-end/src/util/logger";
import { EntityType, EventTypes, EventType } from "back-end/src/types/Audit";
import { AuditInterfaceTemplate } from "back-end/types/audit";
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

export type Context = ApiReqContext | ReqContext;

export const baseSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type BaseSchema = typeof baseSchema;

export type CreateProps<T extends object> = Omit<
  T,
  "id" | "organization" | "dateCreated" | "dateUpdated"
> & { id?: string };

export type CreateRawShape<T extends z.ZodRawShape> = {
  [k in keyof Omit<
    T,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >]: T[k];
} & {
  id: z.ZodOptional<z.ZodString>;
};

export type CreateZodObject<T> = T extends z.ZodObject<
  infer RawShape,
  infer UnknownKeysParam,
  infer ZodTypeAny
>
  ? z.ZodObject<CreateRawShape<RawShape>, UnknownKeysParam, ZodTypeAny>
  : never;

export const createSchema = <T extends BaseSchema>(schema: T) =>
  (schema
    .omit({
      organization: true,
      dateCreated: true,
      dateUpdated: true,
    })
    .extend({ id: z.string().optional() })
    .strict() as unknown) as CreateZodObject<T>;

export type UpdateProps<T extends object> = Partial<
  Omit<T, "id" | "organization" | "dateCreated" | "dateUpdated">
>;

export type UpdateRawShape<T extends z.ZodRawShape> = {
  [k in keyof Omit<
    T,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >]: z.ZodOptional<T[k]>;
};

export type UpdateZodObject<T> = T extends z.ZodObject<
  infer RawShape,
  infer UnknownKeysParam,
  infer ZodTypeAny
>
  ? z.ZodObject<UpdateRawShape<RawShape>, UnknownKeysParam, ZodTypeAny>
  : never;

const updateSchema = <T extends BaseSchema>(schema: T) =>
  (schema
    .omit({
      organization: true,
      dateCreated: true,
      dateUpdated: true,
    })
    .partial()
    .strict() as unknown) as UpdateZodObject<T>;

type AuditLogConfig<Entity extends EntityType> = {
  entity: Entity;
  createEvent: EventTypes<Entity>;
  updateEvent: EventTypes<Entity>;
  deleteEvent: EventTypes<Entity>;
};

export interface ModelConfig<T extends BaseSchema, Entity extends EntityType> {
  schema: T;
  collectionName: string;
  idPrefix?: string;
  auditLog: AuditLogConfig<Entity>;
  globallyUniqueIds?: boolean;
  skipDateUpdatedFields?: (keyof z.infer<T>)[];
  readonlyFields?: (keyof z.infer<T>)[];
  additionalIndexes?: {
    fields: Partial<
      {
        [key in keyof z.infer<T>]: 1 | -1;
      }
    >;
    unique?: boolean;
  }[];
}

// Global set to track which collections we've added indexes to already
// We only need to add indexes once at server start-up
const indexesAdded: Set<string> = new Set();

// Generic model class has everything but the actual data fetch implementation.
// See BaseModel below for the class with explicit mongodb implementation.
export abstract class BaseModel<
  T extends BaseSchema,
  E extends EntityType,
  WriteOptions = never
> {
  public validator: T;
  public createValidator: CreateZodObject<T>;
  public updateValidator: UpdateZodObject<T>;

  protected context: Context;

  public constructor(context: Context) {
    this.context = context;
    this.config = this.getConfig();
    this.validator = this.config.schema;
    this.createValidator = createSchema(this.config.schema);
    this.updateValidator = updateSchema(this.config.schema);
    this.addIndexes();
  }

  /***************
   * Required methods that MUST be overridden by subclasses
   ***************/
  protected config: ModelConfig<T, E>;
  protected abstract getConfig(): ModelConfig<T, E>;
  protected abstract canRead(doc: z.infer<T>): boolean;
  protected abstract canCreate(doc: z.infer<T>): boolean;
  protected abstract canUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
    newDoc: z.infer<T>
  ): boolean;
  protected abstract canDelete(existing: z.infer<T>): boolean;

  /***************
   * Optional methods that can be overridden by subclasses as needed
   ***************/
  protected useConfigFile(): boolean {
    return false;
  }
  protected getConfigDocuments(): z.infer<T>[] {
    return [];
  }
  protected async filterByReadPermissions(
    docs: z.infer<T>[]
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
  protected async customValidation(
    doc: z.infer<T>,
    writeOptions?: WriteOptions
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
    writeOptions?: WriteOptions
  ) {
    // Do nothing by default
  }
  protected async afterUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
    newDoc: z.infer<T>,
    writeOptions?: WriteOptions
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
    writeOptions?: WriteOptions
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

    return keys;
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
  public getAll() {
    return this._find();
  }
  public create(
    props: CreateProps<z.infer<T>>,
    writeOptions?: WriteOptions
  ): Promise<z.infer<T>> {
    return this._createOne(props, writeOptions);
  }
  public update(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
    writeOptions?: WriteOptions
  ): Promise<z.infer<T>> {
    return this._updateOne(existing, updates, { writeOptions });
  }
  public async updateById(
    id: string,
    updates: UpdateProps<z.infer<T>>,
    writeOptions?: WriteOptions
  ): Promise<z.infer<T>> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find resource to update");
    }
    return this._updateOne(existing, updates, { writeOptions });
  }
  public async delete(
    existing: z.infer<T>,
    writeOptions?: WriteOptions
  ): Promise<z.infer<T> | undefined> {
    await this._deleteOne(existing, writeOptions);
    return existing;
  }
  public async deleteById(
    id: string,
    writeOptions?: WriteOptions
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
  protected async _find(
    query: FilterQuery<Omit<z.infer<T>, "organization">> = {},
    {
      sort,
      limit,
      skip,
      bypassReadPermissionChecks,
    }: {
      sort?: Partial<
        {
          [key in keyof Omit<z.infer<T>, "organization">]: 1 | -1;
        }
      >;
      limit?: number;
      skip?: number;
      bypassReadPermissionChecks?: boolean;
    } = {}
  ) {
    const queryWithOrg = {
      ...query,
      organization: this.context.org.id,
    };
    let rawDocs;

    if (this.useConfigFile()) {
      const docs =
        this.getConfigDocuments().filter((doc) =>
          evalCondition(doc, queryWithOrg)
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
      const cursor = this._dangerousGetCollection().find(queryWithOrg);
      sort &&
        cursor.sort(
          sort as {
            [key: string]: 1 | -1;
          }
        );
      rawDocs = await cursor.toArray();
    }

    if (!rawDocs.length) return [];

    const migrated = rawDocs.map((d) =>
      this.migrate(this._removeMongooseFields(d))
    );
    const filtered = bypassReadPermissionChecks
      ? migrated
      : await this.filterByReadPermissions(migrated);

    if (!skip && !limit) return filtered;

    return filtered.slice(skip || 0, limit ? (skip || 0) + limit : undefined);
  }

  protected async _findOne(
    query: FilterQuery<Omit<z.infer<T>, "organization">>
  ) {
    const doc = this.useConfigFile()
      ? this.getConfigDocuments().find((doc) =>
          evalCondition(doc, { ...query, organization: this.context.org.id })
        )
      : await this._dangerousGetCollection().findOne({
          ...query,
          organization: this.context.org.id,
        });
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
    writeOptions?: WriteOptions
  ) {
    const props = this.createValidator.parse(rawData);

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

    const doc = {
      id: this._generateId(),
      ...props,
      organization: this.context.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    } as z.infer<T>;

    await this.populateForeignRefs([doc]);
    if (!this.canCreate(doc)) {
      throw new Error("You do not have access to create this resource");
    }

    await this.validateProjectFields(doc);
    await this.customValidation(doc, writeOptions);

    if (this.useConfigFile()) {
      throw new Error(
        `Cannot create - ${this.config.collectionName} are being managed by config.yml`
      );
    }

    await this.beforeCreate(doc, writeOptions);

    await this._dangerousGetCollection().insertOne(doc);

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
        `Error creating audit log for ${this.config.auditLog.createEvent}`
      );
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
    }
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
        (k) => k in updates
      )
    ) {
      throw new Error(
        "Cannot update id, organization, dateCreated, or dateUpdated"
      );
    }

    if (this.config.readonlyFields) {
      const readonlyFields = new Set(this.config.readonlyFields);
      if (updatedFields.some((field) => readonlyFields.has(field))) {
        throw new Error(
          "Cannot update readonly fields: " + [...readonlyFields].join(", ")
        );
      }
    }

    // Only set dateUpdated if at least one important field has changed
    const setDateUpdated = updatedFields.some(
      (field) => !this.config.skipDateUpdatedFields?.includes(field)
    );

    const allUpdates = {
      ...updates,
      ...(setDateUpdated ? { dateUpdated: new Date() } : null),
    };

    const newDoc = { ...doc, ...allUpdates } as z.infer<T>;

    await this.populateForeignRefs([newDoc]);

    if (!this.canUpdate(doc, updates, newDoc)) {
      throw new Error("You do not have access to update this resource");
    }

    await this.validateProjectFields(updates as Partial<z.infer<T>>);

    if (this.useConfigFile()) {
      throw new Error(
        `Cannot update - ${this.config.collectionName} are being managed by config.yml`
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
      }
    );

    const auditEvent = options?.auditEvent || this.config.auditLog.updateEvent;
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
        `Error creating audit log for ${auditEvent}`
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

  protected async _deleteOne(doc: z.infer<T>, writeOptions?: WriteOptions) {
    if (!this.canDelete(doc)) {
      throw new Error("You do not have access to delete this resource");
    }

    if (this.useConfigFile()) {
      throw new Error(
        `Cannot delete - ${this.config.collectionName} are being managed by config.yml`
      );
    }
    await this.beforeDelete(doc, writeOptions);
    await this._dangerousGetCollection().deleteOne({
      organization: this.context.org.id,
      id: doc.id,
    });

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
        `Error creating audit log for ${this.config.auditLog.deleteEvent}`
      );
    }

    await this.afterDelete(doc, writeOptions);
  }

  protected detectForeignKey(
    doc: z.infer<T>,
    potentialFields: string[]
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
    throwIfMissing: boolean = true
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
            `Could not find foreign ref for ${type}: ${keys[type]}`
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
        this.config.collectionName
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
        }
      );
    });

    await this.context.populateForeignRefs(mergedKeys);
  }
  protected addIndexes() {
    if (indexesAdded.has(this.config.collectionName)) return;
    indexesAdded.add(this.config.collectionName);

    // Always create a unique index for organization and id
    this._dangerousGetCollection()
      .createIndex({ id: 1, organization: 1 }, { unique: true })
      .catch((err) => {
        logger.error(
          `Error creating org/id unique index for ${this.config.collectionName}`,
          err
        );
      });

    // If id is globally unique, create an index for that
    if (this.config.globallyUniqueIds) {
      this._dangerousGetCollection()
        .createIndex({ id: 1 }, { unique: true })
        .catch((err) => {
          logger.error(
            `Error creating id unique index for ${this.config.collectionName}`,
            err
          );
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
            `Error creating ${Object.keys(index.fields).join("/")} ${
              index.unique ? "unique " : ""
            }index for ${this.config.collectionName}`,
            err
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
          projects.some((proj) => proj.id === p)
        )
      ) {
        throw new Error("Invalid project");
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _removeMongooseFields(doc: any) {
    return omit(doc, ["__v", "_id"]) as unknown;
  }
}

export const MakeModelClass = <T extends BaseSchema, E extends EntityType>(
  config: ModelConfig<T, E>
) => {
  abstract class Model<WriteOptions = never> extends BaseModel<
    T,
    E,
    WriteOptions
  > {
    getConfig() {
      return config;
    }
  }

  return Model;
};
