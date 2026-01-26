import { z } from "zod";
import {
  customFieldsPropsValidator,
  customFieldsValidator,
  apiCustomFieldInterface,
  apiCreateCustomFieldBody,
  apiUpdateCustomFieldBody,
  ApiCustomField,
} from "shared/validators";
import { ApiRequest } from "back-end/src/util/handler";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: customFieldsValidator,
  collectionName: "customfields",
  idPrefix: "cfd_",
  auditLog: {
    entity: "customField",
    createEvent: "customField.create",
    updateEvent: "customField.update",
    deleteEvent: "customField.delete",
  },
  globallyUniqueIds: false,
  apiConfig: {
    modelKey: "customFields",
    modelSingular: "customField",
    modelPlural: "customFields",
    apiInterface: apiCustomFieldInterface,
    schemas: {
      createBody: apiCreateCustomFieldBody,
      updateBody: apiUpdateCustomFieldBody,
    },
    pathBase: "/custom-fields",
    includeDefaultCrud: false,
    crudActions: ["create", "delete", "get", "update"],
    customHandlers: [
      defineCustomApiHandler({
        pathFragment: "",
        verb: "get",
        operationId: "listCustomFields",
        validator: {
          bodySchema: z.never(),
          querySchema: z.strictObject({ projectId: z.string().optional() }),
          paramsSchema: z.never(),
        },
        zodReturnObject: z.array(apiCustomFieldInterface),
        summary: "Get all custom fields",
        reqHandler: async (req): Promise<ApiCustomField[]> => {
          const projectId = req.query.projectId;
          const fields = projectId
            ? await req.context.models.customFields.getCustomFieldsByProject(
                projectId,
              )
            : (await req.context.models.customFields.getCustomFields())?.fields;
          return (fields ?? []).map(
            req.context.models.customFields.singleFieldToApiInterface,
          );
        },
      }),
    ],
  },
});

export type CustomField = z.infer<typeof customFieldsPropsValidator>;

export class CustomFieldModel extends BaseClass {
  protected canRead(): boolean {
    return true;
  }

  protected canCreate(): boolean {
    return this.context.permissions.canManageCustomFields();
  }

  protected canUpdate(): boolean {
    return this.context.permissions.canManageCustomFields();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canManageCustomFields();
  }

  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("custom-metadata");
  }

  public async getCustomFields() {
    const customFieldsArr = await this.getAll();
    if (customFieldsArr && customFieldsArr.length > 0) {
      return customFieldsArr[0];
    }
    return null;
  }

  public async getCustomFieldByFieldId(customFieldId: string) {
    const customFields = await this.getCustomFields();
    if (!customFields) {
      return null;
    }
    return (
      customFields.fields.find((field) => {
        if (field.id === customFieldId) {
          return field;
        }
      }) || null
    );
  }

  public async getCustomFieldsByProject(projectId: string) {
    const customFields = await this.getCustomFields();
    if (!customFields) {
      return null;
    }
    return customFields.fields.filter(
      (field) =>
        field.projects?.includes(projectId) || field.projects?.length === 0,
    );
  }

  public async getCustomFieldsBySectionAndProject({
    section,
    project,
  }: {
    section: string;
    project?: string;
  }) {
    const customFields = await this.getCustomFields();
    const filteredCustomFields = customFields?.fields.filter(
      (v) => v.section === section,
    );
    if (!filteredCustomFields || filteredCustomFields.length === 0) {
      return filteredCustomFields;
    }
    return filteredCustomFields.filter((v) => {
      if (v.projects && v.projects.length && v.projects[0] !== "") {
        let matched = false;
        v.projects.forEach((p) => {
          if (p === project) {
            matched = true;
          }
        });
        return matched;
      }
      return true;
    });
  }

  /**
   * Because each organization should only have one set of custom fields,
   * this method will either create a new set of custom fields or update
   * the existing set. Also, each custom field has its own unique id, and
   * this should not be set outside of the model.
   * @param customField
   */
  public async addCustomField(
    customField: Omit<
      CustomField,
      "dateCreated" | "dateUpdated" | "creator" | "active"
    >,
  ) {
    const newCustomField = {
      active: true,
      ...customField,
      creator: this.context.userId,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    const existing = await this.getCustomFields();
    if (existing) {
      const idMatch = existing.fields.find(
        ({ id }) => id === newCustomField.id,
      );
      if (idMatch) {
        this.context.throwBadRequestError(
          "Failed to add custom field. Key not unique!",
        );
      }
      const newFields = [...existing.fields, newCustomField];
      const updated = await this.update(existing, { fields: newFields });
      if (!updated) {
        throw new Error("Failed to add custom field");
      }
      return updated;
    }

    const created = await this.create({ fields: [newCustomField] });
    if (!created) {
      throw new Error("Failed to create custom field");
    }
    return created;
  }

  public async updateCustomField(
    customFieldId: string,
    customFieldUpdates: Partial<CustomField>,
  ) {
    const existing = await this.getCustomFields();
    if (!existing) {
      return null;
    }
    const newFields = existing.fields.map((field) => {
      if (field.id === customFieldId) {
        return {
          ...field,
          ...customFieldUpdates,
          id: customFieldId,
          dateCreated: field.dateCreated,
          dateUpdated: new Date(),
        } as CustomField;
      }
      return field;
    });
    return await this.update(existing, { fields: newFields });
  }

  public async deleteCustomField(customFieldId: string) {
    const existing = await this.getCustomFields();
    if (!existing) {
      return null;
    }
    const newFields = existing.fields.filter(
      (field) => field.id !== customFieldId,
    );
    return await this.update(existing, { fields: newFields });
  }

  /**
   * This is required here as the regular update method does not allow for skipping the change check.
   * And reordering custom fields is not a change that is detected.
   * @param oldId
   * @param newId
   */
  public async reorderCustomFields(oldId: string, newId: string) {
    const existing = await this.getCustomFields();
    if (!existing) {
      return null;
    }
    const oldIndex = existing.fields.findIndex((field) => field.id === oldId);
    const newIndex = existing.fields.findIndex((field) => field.id === newId);
    if (oldIndex === -1 || newIndex === -1) {
      return null;
    }
    const newFields = [...existing.fields];
    newFields.splice(newIndex, 0, newFields.splice(oldIndex, 1)[0]);
    return await this._updateOne(existing, { fields: newFields });
  }

  public async handleApiGet(
    req: ApiRequest<
      unknown,
      z.ZodType<{ id: string }>,
      z.ZodTypeAny,
      z.ZodTypeAny
    >,
  ): Promise<ApiCustomField> {
    const id = req.params.id;
    const doc = await this.getCustomFieldByFieldId(id);
    if (!doc) req.context.throwNotFoundError();
    return this.singleFieldToApiInterface(doc);
  }
  public async handleApiCreate(
    req: ApiRequest<unknown, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  ): Promise<ApiCustomField> {
    const parsedBody = apiCreateCustomFieldBody.parse(req.body);
    const containerObject = await this.addCustomField(parsedBody);
    const created = containerObject.fields.find(
      ({ id }) => id === parsedBody.id,
    );
    if (!created)
      this.context.throwInternalServerError("Failed to create custom field");
    return this.singleFieldToApiInterface(created);
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
    await this.deleteCustomField(id);
    return id;
  }

  public async handleApiUpdate(
    req: ApiRequest<
      unknown,
      z.ZodType<{ id: string }>,
      z.ZodTypeAny,
      z.ZodTypeAny
    >,
  ): Promise<ApiCustomField> {
    const id = req.params.id;
    const parsedBody = apiUpdateCustomFieldBody.parse(req.body);
    const containerObject = await this.updateCustomField(id, parsedBody);
    if (!containerObject)
      this.context.throwInternalServerError("Failed to update custom field");
    const updated = containerObject.fields.find(
      ({ id: fieldId }) => fieldId === id,
    );
    if (!updated)
      this.context.throwInternalServerError("Failed to update custom field");
    return this.singleFieldToApiInterface(updated);
  }

  public singleFieldToApiInterface(f: CustomField): ApiCustomField {
    return {
      ...f,
      dateCreated: f.dateCreated.toISOString(),
      dateUpdated: f.dateUpdated.toISOString(),
      active: f.active ?? true,
      projects: f.projects?.filter((p) => p !== ""),
    };
  }
}
