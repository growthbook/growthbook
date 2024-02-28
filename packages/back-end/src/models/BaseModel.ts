/* eslint-disable @typescript-eslint/no-unused-vars */

import uniqid from "uniqid";
import mongoose, { FilterQuery } from "mongoose";
import { Collection } from "mongodb";
import { hasReadAccess } from "shared/permissions";
import omit from "lodash/omit";
import { z } from "zod";
import { isEqual, pick } from "lodash";
import { ApiReqContext } from "../../types/api";
import { Permission, ReqContext } from "../../types/organization";
import { addTags, addTagsDiff } from "./TagModel";

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
  writePermission: Permission;
  projectScoping: "none" | "single" | "multiple";
  globallyUniqueIds?: boolean;
  skipDateUpdatedFields?: (keyof z.infer<T>)[];
  additionalIndexes?: {
    fields: Partial<
      {
        [key in keyof z.infer<T>]: 1 | -1;
      }
    >;
    unique?: boolean;
  }[];
}

type CreateProps<T extends BaseSchema> = Omit<
  z.infer<T>,
  "id" | "organization" | "dateCreated" | "dateUpdated"
> & { id?: string };

type UpdateProps<T extends BaseSchema> = Partial<
  Omit<z.infer<T>, "id" | "organization" | "dateCreated" | "dateUpdated">
>;

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
    updates: UpdateProps<T>,
    newDoc: z.infer<T>
  ) {
    // Do nothing by default
  }
  protected async afterUpdate(
    existing: z.infer<T>,
    updates: UpdateProps<T>,
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

    // TODO: create indexes in Mongo if they don't exist

    indexesAdded.add(this.config.collectionName);
  }

  // Built-in public methods
  public getById(id: string) {
    return this._findOne({ id });
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
        if (
          !hasReadAccess(
            this.context.readAccessFilter,
            this._getProjectField(migrated)
          )
        ) {
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
      if (
        !hasReadAccess(
          this.context.readAccessFilter,
          this._getProjectField(migrated)
        )
      ) {
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

  // eslint-disable-next-line
  protected async _standardFieldValidation(obj: Partial<z.infer<T>>) {
    // TODO: if `project` is being set, make sure it's a valid id
    // TODO: if `projects` is being set, make sure they are all valid ids
    // TODO: if `datasource` is being set, make sure it's a valid id
    // TODO: other field validations
  }

  protected async _createOne(props: CreateProps<T>) {
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

    // TODO: permission checks

    // Validate the new doc (sanity check in case Typescript errors are ignored for any reason)
    this.config.schema.parse(doc);

    await this._standardFieldValidation(doc);
    await this.customValidation(doc);

    await this.beforeCreate(doc);

    await this._dangerousGetCollection().insertOne(doc);

    // TODO: audit log

    await this.afterCreate(doc);

    // Add tags if needed
    if ("tags" in doc && Array.isArray(doc.tags) && doc.tags.length > 0) {
      await addTags(this.context.org.id, doc.tags);
    }

    return doc;
  }

  protected async _updateOne(doc: z.infer<T>, updates: UpdateProps<T>) {
    // Only consider updates that actually change the value
    const updatedFields = Object.entries(updates)
      .filter(([k, v]) => !isEqual(doc[k as keyof z.infer<T>], v))
      .map(([k]) => k) as (keyof z.infer<T>)[];
    updates = pick(updates, updatedFields);

    // If no updates are needed, return immediately
    if (!updatedFields.length) {
      return doc;
    }

    // TODO: permission checks
    // TODO: if updating projects, check permissions before and after

    // Only set dateUpdated if at least one important field has changed
    const setDateUpdated = updatedFields.some(
      (field) => !this.config.skipDateUpdatedFields?.includes(field)
    );

    const allUpdates = {
      ...updates,
      ...(setDateUpdated ? { dateUpdated: new Date() } : null),
    };

    const newDoc = { ...doc, ...allUpdates } as z.infer<T>;

    // Validate the new doc (sanity check in case Typescript errors are ignored for any reason)
    this.config.schema.parse(newDoc);

    await this.beforeUpdate(doc, updates, newDoc);

    await this._standardFieldValidation(newDoc);
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

    // TODO: audit log

    await this.afterUpdate(doc, updates, newDoc);

    // Update tags if needed
    // TODO: keep a reference of current tags in Context to make this more efficient
    if (
      "tags" in newDoc &&
      Array.isArray(newDoc.tags) &&
      newDoc.tags.length > 0
    ) {
      await addTagsDiff(
        this.context.org.id,
        (doc as z.infer<T> & { tags?: string[] }).tags || [],
        newDoc.tags
      );
    }

    return newDoc;
  }

  protected async _deleteOne(doc: z.infer<T>) {
    // TODO: permission checks

    await this.beforeDelete(doc);
    await this._dangerousGetCollection().deleteOne({
      organization: this.context.org.id,
      id: doc.id,
    });

    // TODO: audit log

    await this.afterDelete(doc);
  }

  // eslint-disable-next-line
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
