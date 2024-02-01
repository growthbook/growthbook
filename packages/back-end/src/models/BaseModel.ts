import uniqid from "uniqid";
import mongoose, { FilterQuery } from "mongoose";
import { Collection } from "mongodb";
import { hasReadAccess } from "shared/permissions";
import omit from "lodash/omit";
import { ApiReqContext } from "../../types/api";
import { Permission, ReqContext } from "../../types/organization";

export interface AutoFields {
  id: string;
  organization: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
}

export interface AutoFieldsWithProject extends AutoFields {
  project: string;
}
export interface AutoFieldsWithProjects extends AutoFields {
  projects: string[];
}

export interface ModelConfig<T> {
  collectionName: string;
  idPrefix?: string;
  writePermission: Permission;
  projectScoping: "none" | "single" | "multiple";
  globallyUniqueIds?: boolean;
  readonlyFields?: (keyof T)[] | readonly (keyof T)[];
  skipDateUpdatedFields?: (keyof T)[] | readonly (keyof T)[];
  // TODO: the fields below are not supported yet and do nothing
  additionalIndexes?: {
    fields: Partial<
      {
        [key in keyof T]: 1 | -1;
      }
    >;
    unique?: boolean;
  }[];
}

export type CreateProps<T extends AutoFields> = Omit<
  T,
  "id" | "dateCreated" | "dateUpdated" | "organization"
> & { id?: string };

export type UpdateProps<T extends AutoFields> = Partial<
  Omit<T, "id" | "organization" | "dateCreated" | "dateUpdated">
>;

export abstract class BaseModel<T extends AutoFields> {
  protected abstract config: ModelConfig<T>;

  // Methods that can be overridden by subclasses
  protected migrate(legacyDoc: unknown): T {
    return legacyDoc as T;
  }
  // eslint-disable-next-line
  protected async beforeCreate(props: CreateProps<T>) {
    // Do nothing by default
  }
  // eslint-disable-next-line
  protected async afterCreate(doc: T) {
    // Do nothing by default
  }
  // eslint-disable-next-line
  protected async beforeUpdate(existing: T, updates: UpdateProps<T>) {
    // Do nothing by default
  }
  // eslint-disable-next-line
  protected async afterUpdate(existing: T, updates: UpdateProps<T>, newDoc: T) {
    // Do nothing by default
  }
  // eslint-disable-next-line
  protected async beforeDelete(doc: T) {
    // Do nothing by default
  }
  // eslint-disable-next-line
  protected async afterDelete(doc: T) {
    // Do nothing by default
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
  public create(props: CreateProps<T>) {
    return this._createOne(props);
  }
  public update(existing: T, updates: UpdateProps<T>) {
    return this._updateOne(existing, updates);
  }
  public delete(existing: T) {
    return this._deleteOne(existing);
  }

  // Internal methods
  protected context: ReqContext | ApiReqContext;
  public constructor(context: ReqContext | ApiReqContext) {
    this.context = context;
  }
  protected _generateId() {
    return uniqid(this.config.idPrefix);
  }
  protected async _find(
    query: FilterQuery<Omit<T, "organization">> = {},
    {
      sort,
      limit,
      skip,
    }: {
      sort?: Partial<
        {
          [key in keyof Omit<T, "organization">]: 1 | -1;
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

    const docs: T[] = [];
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

  protected async _findOne(query: FilterQuery<Omit<T, "organization">>) {
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

  private _getProjectField(doc: T) {
    if (this.config.projectScoping === "none") return undefined;
    if (this.config.projectScoping === "single") {
      return (doc as T & { project?: string }).project || undefined;
    }
    if (this.config.projectScoping === "multiple") {
      return (doc as T & { projects?: string[] }).projects || undefined;
    }
    return undefined;
  }

  protected async _createOne(props: CreateProps<T>) {
    if (this.config.globallyUniqueIds && "id" in props) {
      throw new Error("Cannot set a custom id for this model");
    }

    await this.beforeCreate(props);

    // TODO: permission checks

    const doc = {
      id: this._generateId(),
      ...props,
      organization: this.context.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    } as T;

    await this._dangerousGetCollection().insertOne(doc);

    // TODO: audit log

    await this.afterCreate(doc);

    return doc;
  }

  protected async _updateOne(
    doc: T,
    updates: Partial<
      Omit<T, "id" | "organization" | "dateCreated" | "dateUpdated">
    >
  ) {
    // TODO: permission checks

    const updatedFields = Object.keys(updates);

    if (this.config.readonlyFields) {
      for (const field of updatedFields) {
        if (this.config.readonlyFields.includes(field as keyof T)) {
          throw new Error(`Cannot update readonly field: ${field}`);
        }
      }
    }

    await this.beforeUpdate(doc, updates);

    // Only set dateUpdated if at least one important field has changed
    const setDateUpdated = updatedFields.some(
      (field) => !this.config.skipDateUpdatedFields?.includes(field as keyof T)
    );

    const allUpdates = {
      ...updates,
      ...(setDateUpdated ? { dateUpdated: new Date() } : null),
    };

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

    const newDoc = { ...doc, ...allUpdates } as T;
    await this.afterUpdate(doc, updates, newDoc);

    return newDoc;
  }

  protected async _deleteOne(doc: T) {
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
