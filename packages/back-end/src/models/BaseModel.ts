/* eslint-disable @typescript-eslint/no-unused-vars */

import uniqid from "uniqid";
import mongoose, { FilterQuery } from "mongoose";
import { Collection } from "mongodb";
import omit from "lodash/omit";
import { z } from "zod";
import { isEqual, pick, uniq } from "lodash";
import { ApiReqContext } from "../../types/api";
import { Permission, ReqContext } from "../../types/organization";
import { CreateProps, UpdateProps } from "../../types/models";
import { logger } from "../util/logger";
import { EventType } from "../../types/audit";
import { EntityType } from "../types/Audit";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../services/audit";

export type BaseSchema = z.ZodObject<
  {
    id: z.ZodString;
    organization: z.ZodString;
    dateCreated: z.ZodDate;
    dateUpdated: z.ZodDate;
  },
  "strict"
>;

export interface ModelConfig<T extends BaseSchema> {
  schema: T;
  collectionName: string;
  idPrefix?: string;
  permissions: {
    read: Permission | Permission[];
    create: Permission | Permission[];
    update: Permission | Permission[];
    delete: Permission | Permission[];
  };
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

const indexesAdded: Set<string> = new Set();

export abstract class BaseModel<T extends BaseSchema> {
  protected abstract config: ModelConfig<T>;
  // Methods that can be overridden by subclasses
  protected migrate(legacyDoc: unknown): z.infer<T> {
    return legacyDoc as z.infer<T>;
  }
  protected async customValidation(doc: z.infer<T>) {
    // Do nothing by default
  }
  protected async beforeCreate(props: z.infer<T>) {
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

  private addIndexes() {
    if (indexesAdded.has(this.config.collectionName)) return;
    indexesAdded.add(this.config.collectionName);

    // Always create a unique index for organization and id
    this._dangerousGetCollection()
      .createIndex({ organization: 1, id: 1 }, { unique: true })
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

  // Built-in public methods
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
    return project ? this._find({ project }) : this._find();
  }

  // Internal methods
  protected context: ReqContext | ApiReqContext;
  public constructor(context: ReqContext | ApiReqContext) {
    this.context = context;
    this.addIndexes();
  }
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
        if (!this._hasPermissions([migrated], this.config.permissions.read)) {
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
      if (!this._hasPermissions([migrated], this.config.permissions.read)) {
        return null;
      }
    }

    return migrated;
  }

  private _getProjectField(doc: z.infer<T>) {
    if (this.config.projectScoping === "none") return undefined;
    if (this.config.projectScoping === "single") {
      return (doc as z.infer<T> & { project?: string }).project || undefined;
    }
    if (this.config.projectScoping === "multiple") {
      return (
        (doc as z.infer<T> & { projects?: string[] }).projects || undefined
      );
    }
    return undefined;
  }

  private _hasPermissions(
    docs: z.infer<T>[],
    permissions: Permission | Permission[]
  ) {
    if (!Array.isArray(permissions)) {
      permissions = [permissions];
    }

    const projects = uniq(
      docs.flatMap((doc) => this._getAffectedProjects(doc))
    );

    for (const permission of permissions) {
      if (
        !docs.every((doc) =>
          // TODO: support environment-scoped permission checks
          this.context.hasPermission(
            permission,
            this._getProjectField(doc),
            undefined
          )
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private _requirePermissions(
    docs: z.infer<T>[],
    permissions: Permission | Permission[]
  ) {
    if (!this._hasPermissions(docs, permissions)) {
      throw new Error("You do not have permission to complete that action");
    }
  }

  private _getAffectedProjects(doc: z.infer<T>) {
    const projects = this._getProjectField(doc);
    return Array.isArray(projects) ? projects : projects ? [projects] : [];
  }

  protected async _standardFieldValidation(obj: Partial<z.infer<T>>) {
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
    if ("owner" in props && props.owner === "") {
      // TODO: is id the right thing to store here?
      props.owner = this.context.userId || "";
    }

    const doc = {
      id: this._generateId(),
      ...props,
      organization: this.context.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    } as z.infer<T>;

    this._requirePermissions([doc], this.config.permissions.create);

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

    this._requirePermissions([doc, newDoc], this.config.permissions.update);

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
    this._requirePermissions([doc], this.config.permissions.delete);

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _removeMongooseFields(doc: any) {
    return omit(doc, ["__v", "_id"]) as unknown;
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
}
