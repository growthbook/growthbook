import { omit } from "lodash";
import { z } from "zod";
import {
  customFieldsPropsValidator,
  customFieldsValidator,
  customFieldSectionValues,
  apiCustomFieldInterface,
  apiCreateCustomFieldBody,
  apiUpdateCustomFieldBody,
  ApiCustomField,
} from "shared/validators";
import { CustomFieldSection } from "shared/types/custom-fields";
import { ApiRequest } from "back-end/src/util/handler";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { migrateCustomFieldValues } from "back-end/src/services/customFieldMigration";
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
    crudValidatorOverrides: {
      delete: {
        bodySchema: z.never(),
        querySchema: z.strictObject({
          index: z.coerce.number().optional(),
        }),
        paramsSchema: z.object({ id: z.string() }).strict(),
      },
    },
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

type LegacyCustomField = Omit<CustomField, "sections"> & {
  section?: CustomFieldSection; // legacy
  sections?: CustomFieldSection[];
};

type LegacyCustomFieldsDocument = Omit<
  z.infer<typeof customFieldsValidator>,
  "fields"
> & {
  fields: (CustomField | LegacyCustomField)[];
};

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

  /**
   * JIT readonly migration; does not persist.
   * - normalize projects so [""] from legacy data is never returned
   * - migrate legacy section (singular) to sections (array)
   */
  protected migrate(
    legacyDoc: LegacyCustomFieldsDocument,
  ): z.infer<typeof customFieldsValidator> {
    return {
      ...legacyDoc,
      fields: legacyDoc.fields.map((f) => {
        const projects = (f.projects ?? []).filter((p) => p !== "");
        let sections: CustomFieldSection[];
        if (
          Array.isArray(f.sections) &&
          f.sections.every((s) => customFieldSectionValues.includes(s))
        ) {
          sections = f.sections;
        } else if (
          "section" in f &&
          f.section &&
          customFieldSectionValues.includes(f.section)
        ) {
          sections = [f.section];
        } else {
          sections = ["feature"];
        }
        return {
          ...omit(f, ["section", "sections"]),
          projects,
          sections,
        } as CustomField;
      }),
    };
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
    section: CustomFieldSection;
    project?: string;
  }) {
    const customFields = await this.getCustomFields();
    const filteredCustomFields = customFields?.fields.filter((v) =>
      v.sections?.includes(section),
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
      projects: (customField.projects ?? []).filter((p) => p !== ""),
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
    const existingField = existing.fields.find((f) => f.id === customFieldId);
    const typeChanged =
      customFieldUpdates.type !== undefined &&
      existingField &&
      existingField.type !== customFieldUpdates.type;
    const valuesChanged =
      existingField &&
      (existingField.type === "enum" || existingField.type === "multiselect") &&
      customFieldUpdates.values !== undefined &&
      existingField.values !== customFieldUpdates.values;

    const newFields = existing.fields.map((field) => {
      if (field.id === customFieldId) {
        const merged = {
          ...field,
          ...customFieldUpdates,
          id: customFieldId,
          dateCreated: field.dateCreated,
          dateUpdated: new Date(),
        };
        merged.projects = (merged.projects ?? []).filter((p) => p !== "");
        return merged as CustomField;
      }
      return field;
    });
    const updated = await this.update(existing, { fields: newFields });
    if (!updated) return null;

    if (typeChanged || valuesChanged) {
      const sectionsToMigrate = [
        ...new Set([
          ...(existingField?.sections ?? []),
          ...(customFieldUpdates.sections ??
            existingField?.sections ?? ["feature"]),
        ]),
      ];
      await migrateCustomFieldValues(
        this.context,
        customFieldId,
        sectionsToMigrate as CustomFieldSection[],
        existingField!.type,
        customFieldUpdates.type!,
        existingField!.values,
        customFieldUpdates.values,
      );
    }

    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys: [],
      sdkConnections: [],
      auditContext: {
        event: "updated",
        model: "custom-field",
        id: customFieldId,
      },
    });
    return updated;
  }

  /**
   * Delete a custom field by id. For legacy data with duplicate ids, use index
   * as tiebreaker. If index is provided and matches a field with that id, delete
   * that one; otherwise delete the first occurrence.
   */
  public async deleteCustomField(customFieldId: string, index?: number) {
    const existing = await this.getCustomFields();
    if (!existing) {
      return null;
    }
    const indices = existing.fields
      .map((f, i) => (f.id === customFieldId ? i : -1))
      .filter((i) => i >= 0);
    if (indices.length === 0) {
      return null;
    }
    const toDelete =
      index !== undefined && indices.includes(index) ? index : indices[0];
    const newFields = existing.fields.filter((_, i) => i !== toDelete);
    const updated = await this.update(existing, { fields: newFields });
    if (updated) {
      queueSDKPayloadRefresh({
        context: this.context,
        payloadKeys: [],
        sdkConnections: [],
        auditContext: {
          event: "deleted",
          model: "custom-field",
          id: customFieldId,
        },
      });
    }
    return updated;
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
      z.ZodType<{ index?: number }>,
      z.ZodTypeAny
    >,
  ): Promise<string> {
    const id = req.params.id;
    const index = (req.query as { index?: number }).index;
    await this.deleteCustomField(id, index);
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
