import type { Response } from "express";
import uniqid from "uniqid";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getContextFromReq } from "../../services/organizations";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import {
  CustomField,
  CustomFieldSection,
  CustomFieldsInterface,
  CustomFieldTypes,
} from "../../../types/custom-fields";
import {
  createCustomField,
  deleteCustomFieldById,
  getCustomFieldById,
  getCustomFields,
  updateCustomField,
  updateCustomFieldById,
} from "../../models/CustomFieldModel";

const changeArrayPosition = (
  arr: CustomField[],
  old_index: number,
  new_index: number
) => {
  arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
  return arr; // for testing
};

// region POST /custom-fields

type CreateCustomFieldRequest = AuthRequest<{
  name: string;
  description: string;
  placeholder: string;
  defaultValue?: boolean | string;
  type: CustomFieldTypes;
  values?: string;
  required: boolean;
  index?: boolean;
  projects?: string[];
  section: CustomFieldSection;
}>;

type CreateCustomFieldResponse =
  | {
      status: 200;
      customField: CustomFieldsInterface;
    }
  | {
      status: number;
      message: string;
    };

/**
 * POST /custom-field
 * Create a custom-field resource
 * @param req
 * @param res
 */
export const postCustomField = async (
  req: CreateCustomFieldRequest,
  res: Response<CreateCustomFieldResponse>
) => {
  const { org } = getContextFromReq(req);
  const {
    name,
    description,
    placeholder,
    defaultValue,
    type,
    values,
    required,
    index,
    projects,
    section,
  } = req.body;

  req.checkPermissions("manageCustomFields");

  const existingFields = await getCustomFields(org.id);

  // check if this name already exists:
  if (existingFields) {
    const existingCustomField = existingFields.fields.find(
      (field) => field.name === name && field.section === section
    );
    if (existingCustomField) {
      return res.status(403).json({
        status: 404,
        message: "Custom field name already exists for this section",
      });
    }
  }
  const newCustomField: CustomField = {
    id: uniqid("cfl_"),
    name,
    description,
    placeholder,
    defaultValue,
    type,
    values,
    required,
    index,
    projects,
    section,
    owner: req.userId,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  };

  let newFields: CustomFieldsInterface = {
    id: existingFields?.id ?? uniqid("cfd_"),
    fields: [newCustomField],
    organization: org.id,
  };
  let customField;
  if (existingFields) {
    // the org already has some custom fields - so just append this field:
    newFields = {
      ...existingFields,
      fields: [...existingFields.fields, newCustomField],
    };
    customField = await updateCustomField(org.id, newFields);

    if (!customField) {
      return res.status(403).json({
        status: 404,
        message: "Custom field not updated",
      });
    }
  } else {
    customField = await createCustomField(newFields);
  }

  await req.audit({
    event: "customField.create",
    entity: {
      object: "customField",
      id: customField.id,
      name: name,
    },
    details: auditDetailsCreate(customField),
  });

  return res.status(200).json({
    status: 200,
    customField,
  });
};

// endregion POST /custom-fields

// region POST /custom-fields/reorder

type ReorderCustomFieldsRequest = AuthRequest<{
  oldId: string;
  newId: string;
}>;

type ReorderCustomFieldsResponse =
  | {
      status: 200;
      customField: CustomFieldsInterface;
    }
  | {
      status: number;
      message: string;
    };

/**
 * POST /custom-field/reorder
 * Reorder custom-fields
 * @param req
 * @param res
 */
export const postReorderCustomFields = async (
  req: ReorderCustomFieldsRequest,
  res: Response<ReorderCustomFieldsResponse>
) => {
  const { org } = getContextFromReq(req);
  const { oldId, newId } = req.body;

  req.checkPermissions("manageCustomFields");

  const existingFields = await getCustomFields(org.id);

  // check if this name already exists:
  if (!existingFields || !existingFields.fields) {
    return res.status(403).json({
      status: 404,
      message: "Custom field name already exists for this section",
    });
  }

  const items = existingFields.fields;
  const oldIndex = items?.findIndex((x) => x.id === oldId);
  const newIndex = items?.findIndex((x) => x.id === newId);
  const newItems = changeArrayPosition(items, oldIndex, newIndex);

  const newCustomField = { ...existingFields, fields: newItems };

  const customField = await updateCustomField(org.id, newCustomField);
  if (!customField) {
    return res.status(403).json({
      status: 404,
      message: "Custom field not updated",
    });
  }

  await req.audit({
    event: "customField.update",
    entity: {
      object: "customField",
      id: newCustomField.id,
    },
    details: auditDetailsCreate(customField),
  });

  return res.status(200).json({
    status: 200,
    customField,
  });
};

// endregion POST /custom-fields/reorder

// region PUT /custom-fields/:id

type PutCustomFieldRequest = AuthRequest<
  {
    name: string;
    description: string;
    placeholder: string;
    defaultValue?: boolean | string;
    type: CustomFieldTypes;
    values?: string;
    required: boolean;
    index?: boolean;
    projects?: string[];
    section: CustomFieldSection;
  },
  { id: string }
>;

type PutCustomFieldResponse = {
  status: 200;
};

/**
 * PUT /custom-fields/:id
 * Update one custom-field resource
 * @param req
 * @param res
 */
export const putCustomField = async (
  req: PutCustomFieldRequest,
  res: Response<PutCustomFieldResponse | ApiErrorResponse>
) => {
  const { org } = getContextFromReq(req);
  const {
    name,
    description,
    placeholder,
    defaultValue,
    type,
    values,
    required,
    index,
    projects,
    section,
  } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify custom field id");
  }

  req.checkPermissions("manageCustomFields");

  const customField = await getCustomFieldById(id, org.id);

  if (!customField) {
    throw new Error("Could not find custom field");
  }

  const changes = await updateCustomFieldById(id, org.id, {
    name,
    description,
    placeholder,
    defaultValue,
    type,
    values,
    required,
    index,
    projects,
    section,
  });

  const updatedCustomField = { ...customField, ...changes };

  await req.audit({
    event: "customField.update",
    entity: {
      object: "customField",
      id: updatedCustomField.id,
    },
    details: auditDetailsUpdate(customField, updatedCustomField),
  });

  return res.status(200).json({
    status: 200,
  });
};

// endregion PUT /custom-fields/:id

// region DELETE /custom-fields/:id

type DeleteCustomFieldRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type DeleteCustomFieldResponse =
  | {
      status: 200;
    }
  | {
      status: number;
      message: string;
    };

/**
 * DELETE /custom-fields/:id
 * Delete one custom-field resource by ID
 * @param req
 * @param res
 */
export const deleteCustomField = async (
  req: DeleteCustomFieldRequest,
  res: Response<DeleteCustomFieldResponse>
) => {
  req.checkPermissions("manageCustomFields");

  const { id } = req.params;
  const { org } = getContextFromReq(req);

  const customFields = await getCustomFieldById(id, org.id);

  if (!customFields) {
    res.status(403).json({
      status: 404,
      message: "Custom field not found",
    });
    return;
  }

  await deleteCustomFieldById(id, org.id);

  await req.audit({
    event: "customField.delete",
    entity: {
      object: "customField",
      id: id,
    },
    details: auditDetailsDelete(customFields),
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /custom-fields/:id
