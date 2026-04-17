import { omit } from "lodash";
import { z } from "zod";
import {
  customFieldsPropsValidator,
  customFieldsValidator,
  customFieldSectionValues,
  apiCreateCustomFieldBody,
  apiUpdateCustomFieldBody,
  ApiCustomField,
} from "shared/validators";
import { CustomFieldSection } from "shared/types/custom-fields";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import {
  customFieldApiSpec,
  listCustomFieldsEndpoint,
} from "back-end/src/api/specs/custom-field.spec";
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
  globallyUniquePrimaryKeys: false,
  apiConfig: {
    modelKey: "customFields",
    openApiSpec: customFieldApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...listCustomFieldsEndpoint,
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

  // JIT readonly migration: normalize projects (strips legacy ""), migrate section -> sections.
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
          active: (f as CustomField).active ?? true,
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

  public async getCustomFieldByFieldId(
    customFieldId: string,
    { includeInactive = false } = {},
  ) {
    const customFields = await this.getCustomFields();
    if (!customFields) return null;
    return (
      customFields.fields.find(
        (f) =>
          f.id === customFieldId && (includeInactive || f.active !== false),
      ) ?? null
    );
  }

  public async getCustomFieldsByProject(projectId: string) {
    const customFields = await this.getCustomFields();
    if (!customFields) return null;
    return customFields.fields.filter(
      (field) =>
        field.active !== false &&
        (field.projects?.includes(projectId) || field.projects?.length === 0),
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
    const filteredCustomFields = customFields?.fields.filter(
      (v) => v.active !== false && v.sections?.includes(section),
    );
    if (!filteredCustomFields || filteredCustomFields.length === 0) {
      return filteredCustomFields;
    }
    return filteredCustomFields.filter((v) => {
      if (v.projects && v.projects.length > 0) {
        return v.projects.some((p) => p === project);
      }
      return true;
    });
  }

  public async addCustomField(
    customField: Omit<
      CustomField,
      "dateCreated" | "dateUpdated" | "creator" | "active"
    >,
  ) {
    if (!customField.id.match(/^[a-z0-9_-]+$/)) {
      this.context.throwBadRequestError(
        "Custom field keys can only include lowercase letters, numbers, hyphens, and underscores.",
      );
    }

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
      if (existing.fields.some(({ id }) => id === newCustomField.id)) {
        this.context.throwBadRequestError("Custom field key already exists.");
      }
      const nameConflict = existing.fields.find(
        (f) =>
          f.active !== false &&
          f.name === newCustomField.name &&
          f.sections?.some((s) => newCustomField.sections.includes(s)),
      );
      if (nameConflict) {
        this.context.throwBadRequestError(
          "Custom field name already exists for one or more of the selected sections.",
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
    if (!existing) return null;

    const currentField = existing.fields.find((f) => f.id === customFieldId);
    if (!currentField) return null;

    const newName = customFieldUpdates.name ?? currentField.name;
    const newSections =
      customFieldUpdates.sections ?? currentField.sections ?? [];
    const nameConflict = existing.fields.find(
      (f) =>
        f.id !== customFieldId &&
        f.active !== false &&
        f.name === newName &&
        f.sections?.some((s) => newSections.includes(s)),
    );
    if (nameConflict) {
      this.context.throwBadRequestError(
        "Custom field name already exists for one or more of the selected sections.",
      );
    }

    // Only update the first matching field — orgs with legacy duplicate IDs
    // should not have all copies mutated simultaneously.
    let matchedOnce = false;
    const newFields = existing.fields.map((field) => {
      if (field.id === customFieldId && !matchedOnce) {
        matchedOnce = true;
        const merged = {
          ...field,
          ...customFieldUpdates,
          id: customFieldId,
          active: customFieldUpdates.active ?? field.active ?? true,
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

    queueSDKPayloadRefresh({
      context: this.context,
      payloadKeys: getEnvironmentIdsFromOrg(this.context.org).map((env) => ({
        environment: env,
        project: "",
      })),
      treatEmptyProjectAsGlobal: true,
      auditContext: {
        event: "updated",
        model: "custom-field",
        id: customFieldId,
      },
    });
    return updated;
  }

  // For legacy duplicate ids, `index` is the tiebreaker; falls back to first occurrence.
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
        payloadKeys: getEnvironmentIdsFromOrg(this.context.org).map((env) => ({
          environment: env,
          project: "",
        })),
        treatEmptyProjectAsGlobal: true,
        auditContext: {
          event: "deleted",
          model: "custom-field",
          id: customFieldId,
        },
      });
    }
    return updated;
  }

  // Uses _updateOne directly to bypass the change-detection check (reorders are not detected as diffs).
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

  public override async handleApiGet(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiGet"]>[0],
  ): Promise<ApiCustomField> {
    const id = req.params.id;
    const doc = await this.getCustomFieldByFieldId(id);
    if (!doc) req.context.throwNotFoundError();
    return this.singleFieldToApiInterface(doc);
  }
  public override async handleApiCreate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiCreate"]>[0],
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

  public override async handleApiDelete(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiDelete"]>[0],
  ): Promise<string> {
    const id = req.params.id;
    const rawIndex = req.query.index;
    const index =
      rawIndex !== undefined && rawIndex !== "" ? Number(rawIndex) : undefined;
    await this.deleteCustomField(id, index);
    return id;
  }

  public override async handleApiUpdate(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiUpdate"]>[0],
  ): Promise<ApiCustomField> {
    const id = req.params.id;
    const parsedBody = apiUpdateCustomFieldBody.parse(req.body);
    const containerObject = await this.updateCustomField(id, parsedBody);
    if (!containerObject)
      this.context.throwNotFoundError("Custom field not found");
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
