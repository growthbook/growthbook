import { z } from "zod";
import {
  customFieldsPropsValidator,
  customFieldsValidator,
} from "back-end/src/routers/custom-fields/custom-fields.validators";
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
          field,
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
}
