import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import { CustomFieldsInterface, CustomField } from "../../types/custom-fields";

const customFieldsSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  fields: [
    {
      id: {
        type: String,
        unique: true,
      },
      name: String,
      description: String,
      placeholder: String,
      defaultValue: {},
      type: {
        type: String,
      },
      values: String,
      required: Boolean,
      index: Boolean,
      creator: String,
      projects: [String],
      section: String,
      dateCreated: Date,
      dateUpdated: Date,
      active: Boolean,
    },
  ],
});

type CustomFieldDocument = mongoose.Document & CustomFieldsInterface;

const CustomFieldModel = mongoose.model<CustomFieldsInterface>(
  "customField",
  customFieldsSchema
);

type CreateCustomFieldProps = Omit<
  CustomFieldsInterface,
  "dateCreated" | "dateUpdated" | "id"
>;

type UpdateCustomFieldProps = Omit<
  CustomField,
  "dateCreated" | "dateUpdated" | "id" | "organization"
>;

const toInterface = (doc: CustomFieldDocument): CustomFieldsInterface =>
  omit(
    doc.toJSON<CustomFieldDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );

export async function createCustomField(
  customField: CreateCustomFieldProps
): Promise<CustomFieldsInterface> {
  const fields = await CustomFieldModel.create({
    ...customField,
    id: uniqid("cfd_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  return toInterface(fields);
}

// export async function getAllCustomFields(
//   organization: string
// ): Promise<CustomFieldsInterface[]> {
//   const customFields: CustomFieldDocument[] = await CustomFieldModel.find({
//     organization,
//   });
//   return customFields.map((value) => value.toJSON()) || [];
// }

export async function getCustomFields(
  organization: string
): Promise<CustomFieldsInterface | null> {
  const customField = await CustomFieldModel.findOne({
    organization: organization,
  });

  return customField ? toInterface(customField) : null;
}
export async function getCustomFieldById(
  customFieldId: string,
  organization: string
): Promise<CustomFieldsInterface | null> {
  const customField = await CustomFieldModel.findOne({
    "fields.id": customFieldId,
    organization: organization,
  });

  return customField ? toInterface(customField) : null;
}

export async function updateCustomField(
  organization: string,
  customFields: CustomFieldsInterface
): Promise<CustomFieldsInterface | null> {
  const existing = await getCustomFields(organization);
  if (!existing) {
    return null;
  }
  const updated = { ...existing, ...customFields };
  await CustomFieldModel.updateOne(
    { id: existing.id, organization: organization },
    updated
  );

  return updated;
}
export async function updateCustomFieldById(
  customFieldId: string,
  organization: string,
  customFields: UpdateCustomFieldProps
): Promise<CustomFieldsInterface | null> {
  const changes = {
    ...customFields,
    dateUpdated: new Date(),
  };

  const existingField = await getCustomFieldById(customFieldId, organization);
  if (!existingField) {
    return null;
  }
  const newFields = existingField.fields.map((field) => {
    if (field.id === customFieldId) {
      return {
        ...field,
        ...changes,
      };
    }
    return field;
  });

  await CustomFieldModel.updateOne(
    {
      id: existingField.id,
      organization: organization,
    },
    { ...existingField, fields: newFields }
  );

  return getCustomFieldById(customFieldId, organization);
}

// Deleting custom fields means deleting the element from an array of custom fields.
export async function deleteCustomFieldById(id: string, organization: string) {
  const existingFields = await getCustomFields(organization);
  if (!existingFields) {
    return null;
  }
  const newFields = existingFields.fields.filter((field) => field.id !== id);

  await CustomFieldModel.updateOne(
    {
      id: existingFields.id,
      organization: organization,
    },
    { ...existingFields, fields: newFields }
  );

  return getCustomFieldById(id, organization);
}
