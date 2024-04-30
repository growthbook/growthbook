/* eslint-disable @typescript-eslint/no-unused-vars */

import uniqid from "uniqid";
import mongoose, { FilterQuery } from "mongoose";
import { Collection } from "mongodb";
import omit from "lodash/omit";
import { z } from "zod";
import { isEqual, pick } from "lodash";
import { ApiReqContext } from "../../types/api";
import { ReqContext } from "../../types/organization";
import { CreateProps, UpdateProps } from "../../types/models";
import { logger } from "../util/logger";
import { EventType } from "../../types/audit";
import { EntityType } from "../types/Audit";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../services/audit";

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

export interface ModelConfig<T extends BaseSchema> {
  schema: T;
  collectionName: string;
  idPrefix?: string;
  auditLog: {
    entity: EntityType;
    createEvent: EventType;
    updateEvent: EventType;
    deleteEvent: EventType;
  };
  projectScoping: "none" | "single" | "multiple";
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

export abstract class BaseModel<T extends BaseSchema> {
  protected context: Context;
  public constructor(context: Context) {
    this.context = context;
    this.config = this.getConfig();
    this.addIndexes();
  }

  /***************
   * Required methods that MUST be overridden by subclasses
   ***************/
  protected config: ModelConfig<T>;
  protected abstract getConfig(): ModelConfig<T>;
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
  protected migrate(legacyDoc: unknown): z.infer<T> {
    return legacyDoc as z.infer<T>;
  }
  protected async customValidation(doc: z.infer<T>) {
    // Do nothing by default
  }
  protected async beforeCreate(doc: z.infer<T>) {
    // Do nothing by default
  }
  protected async afterCreate(doc: z.infer<T>) {
    // Do nothing by default
  }
  protected async beforeUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
    newDoc: z.infer<T>
  ) {
    // Do nothing by default
  }
  protected async afterUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<z.infer<T>>,
    newDoc: z.infer<T>
  ) {
    // Do nothing by default
  }
  protected async beforeDelete(doc: z.infer<T>) {
    // Do nothing by default
  }
  protected async afterDelete(doc: z.infer<T>) {
    // Do nothing by default
  }

  /***************
   * Built-in public methods
   ***************/
  public getById(id: string) {
    return this._findOne({ id });
  }
  public getByIds(ids: string[]) {
    return this._find({ id: { $in: ids } });
  }
  public getAll() {
    return this._find();
  }
  public getAllByProject(project: string | undefined) {
    if (this.config.projectScoping === "none") {
      throw new Error("This model does not support projects");
    }

    // If the project is empty, return all
    if (!project) return this._find();

    return this._find(
      this.config.projectScoping === "single"
        ? { project }
        : { projects: project }
    );
  }
  public create(props: unknown | CreateProps<z.infer<T>>): Promise<z.infer<T>> {
    return this._createOne(props);
  }
  public update(
    existing: z.infer<T>,
    updates: unknown | UpdateProps<z.infer<T>>
  ): Promise<z.infer<T>> {
    return this._updateOne(existing, updates);
  }
  public async updateById(
    id: string,
    updates: unknown | UpdateProps<z.infer<T>>
  ): Promise<z.infer<T>> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error("Could not find fact metric");
    }
    return this._updateOne(existing, updates);
  }
  public delete(existing: z.infer<T>): Promise<void> {
    return this._deleteOne(existing);
  }
  public async deleteById(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      // If it doesn't exist, maybe it was deleted already. No need to throw an error.
      return;
    }
    return this._deleteOne(existing);
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
    }: {
      sort?: Partial<
        {
          [key in keyof Omit<z.infer<T>, "organization">]: 1 | -1;
        }
      >;
      limit?: number;
      skip?: number;
    } = {}
  ) {
    const queryWithOrg = {
      organization: this.context.org.id,
      ...query,
    };
    const cursor = this._dangerousGetCollection().find(queryWithOrg);

    sort &&
      cursor.sort(
        sort as {
          [key: string]: 1 | -1;
        }
      );

    // If there's no project field, we can apply the range filter in the query
    // Otherwise, we need to apply it in code after we check read access
    if (this.config.projectScoping === "none") {
      if (skip) cursor.skip(skip);
      if (limit) cursor.limit(limit);
    }

    const docs: z.infer<T>[] = [];
    let i = -1;
    for await (const doc of cursor) {
      const migrated = this.migrate(this._removeMongooseFields(doc));

      // Filter out any docs the user doesn't have access to read
      if (this.config.projectScoping !== "none") {
        if (!this.canRead(migrated)) {
          continue;
        }

        i++;

        // Apply range filter (skip/limit)
        if (skip && i < skip) continue;
        if (limit && i >= (skip || 0) + limit) break;
      }

      docs.push(migrated);
    }

    return docs;
  }

  protected async _findOne(
    query: FilterQuery<Omit<z.infer<T>, "organization">>
  ) {
    const doc = await this._dangerousGetCollection().findOne({
      ...query,
      organization: this.context.org.id,
    });
    if (!doc) return null;

    const migrated = this.migrate(this._removeMongooseFields(doc));
    if (this.config.projectScoping !== "none") {
      if (!this.canRead(migrated)) {
        return null;
      }
    }

    return migrated;
  }

  protected async _createOne(rawData: unknown | CreateProps<z.infer<T>>) {
    const props = this.config.schema
      .omit({ organization: true, dateCreated: true, dateUpdated: true })
      .partial({ id: true })
      .parse(rawData) as CreateProps<z.infer<T>>;

    if (this.config.globallyUniqueIds && "id" in props) {
      throw new Error("Cannot set a custom id for this model");
    }
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

    if (!this.canCreate(doc)) {
      throw new Error("You do not have access to create this resource");
    }

    await this._standardFieldValidation(doc);
    await this.customValidation(doc);

    await this.beforeCreate(doc);

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
      });
    } catch (e) {
      this.context.logger.error(
        e,
        `Error creating audit log for ${this.config.auditLog.createEvent}`
      );
    }

    await this.afterCreate(doc);

    // Add tags if needed
    if ("tags" in doc && Array.isArray(doc.tags)) {
      await this.context.registerTags(doc.tags);
    }

    return doc;
  }

  protected async _updateOne(
    doc: z.infer<T>,
    rawUpdates: unknown | UpdateProps<z.infer<T>>,
    options?: {
      auditEvent?: EventType;
    }
  ) {
    let updates = this.config.schema
      .omit({
        organization: true,
        dateCreated: true,
        dateUpdated: true,
        id: true,
      })
      .partial()
      .parse(rawUpdates) as UpdateProps<z.infer<T>>;

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

    if (!this.canUpdate(doc, updates, newDoc)) {
      throw new Error("You do not have access to update this resource");
    }

    await this._standardFieldValidation(updates as Partial<z.infer<T>>);

    await this.beforeUpdate(doc, updates, newDoc);

    await this.customValidation(newDoc);

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
      });
    } catch (e) {
      this.context.logger.error(
        e,
        `Error creating audit log for ${auditEvent}`
      );
    }

    await this.afterUpdate(doc, updates, newDoc);

    // Update tags if needed
    if ("tags" in newDoc && Array.isArray(newDoc.tags)) {
      await this.context.registerTags(newDoc.tags);
    }

    return newDoc;
  }

  protected async _deleteOne(doc: z.infer<T>) {
    if (!this.canDelete(doc)) {
      throw new Error("You do not have access to delete this resource");
    }
    await this.beforeDelete(doc);
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
      });
    } catch (e) {
      this.context.logger.error(
        e,
        `Error creating audit log for ${this.config.auditLog.deleteEvent}`
      );
    }

    await this.afterDelete(doc);
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

  /***************
   * Private methods
   ***************/
  private addIndexes() {
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

  private async _standardFieldValidation(obj: Partial<z.infer<T>>) {
    // Validate common foreign key references
    if (this.config.projectScoping === "single") {
      if ("project" in obj && obj.project) {
        const projects = await this.context.getProjects();
        if (!projects.some((p) => p.id === obj.project)) {
          throw new Error("Invalid project");
        }
      }
    } else if (this.config.projectScoping === "multiple") {
      if ("projects" in obj && obj.projects && Array.isArray(obj.projects)) {
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
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _removeMongooseFields(doc: any) {
    return omit(doc, ["__v", "_id"]) as unknown;
  }
}

export const MakeModelClass = <T extends BaseSchema>(
  config: ModelConfig<T>
) => {
  abstract class Model extends BaseModel<T> {
    getConfig() {
      return config;
    }
  }

  return Model;
};
