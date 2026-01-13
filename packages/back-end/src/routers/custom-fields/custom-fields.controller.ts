import type { Response } from "express";
import {
  CustomFieldSection,
  CustomFieldsInterface,
  CustomFieldTypes,
  CreateCustomFieldProps,
} from "shared/types/custom-fields";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";

// region POST /custom-fields

type CreateCustomFieldRequest = AuthRequest<CreateCustomFieldProps>;

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
  res: Response<CreateCustomFieldResponse>,
) => {
  const {
    id,
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

  const context = getContextFromReq(req);
  if (!context.permissions.canManageCustomFields()) {
    context.permissions.throwPermissionError();
  }

  if (!id) {
    throw new Error("Must specify field key");
  }

  if (!id.match(/^[a-z0-9_-]+$/)) {
    throw new Error(
      "Custom field keys can only include lowercase letters, numbers, hyphens, and underscores.",
    );
  }
  const existingFields = await context.models.customFields.getCustomFields();

  // check if this name already exists:
  if (existingFields) {
    const existingCustomField = existingFields.fields.find(
      (field) => field.name === name && field.section === section,
    );
    if (existingCustomField) {
      throw new Error("Custom field name already exists for this section");
    }
  }

  const updated = await context.models.customFields.addCustomField({
    id,
    name,
    description,
    placeholder,
    defaultValue,
    type,
    values,
    required,
    index: !!index,
    projects,
    section,
  });

  if (!updated) {
    throw new Error("Custom field not created");
  }

  return res.status(200).json({
    status: 200,
    customField: updated,
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
  res: Response<ReorderCustomFieldsResponse>,
) => {
  const { oldId, newId } = req.body;

  req.checkPermissions("manageCustomFields");
  const context = getContextFromReq(req);

  const existingFields = await context.models.customFields.getCustomFields();

  // check if this name already exists:
  if (!existingFields || !existingFields.fields) {
    return res.status(403).json({
      status: 403,
      message: "Could not find the custom fields",
    });
  }

  const customField = await context.models.customFields.reorderCustomFields(
    oldId,
    newId,
  );

  if (!customField) {
    return res.status(403).json({
      status: 404,
      message: "Custom field not updated",
    });
  }

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
  res: Response<PutCustomFieldResponse>,
) => {
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

  const context = getContextFromReq(req);

  const newCustomFields = await context.models.customFields.updateCustomField(
    id,
    {
      name,
      description,
      placeholder,
      defaultValue,
      type,
      values,
      required,
      index: !!index,
      projects,
      section,
    },
  );

  if (!newCustomFields) {
    throw new Error("Custom field not updated");
  }

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

/**
 * DELETE /custom-fields/:id
 * Delete one custom-field resource by ID
 * @param req
 * @param res
 */
export const deleteCustomField = async (
  req: DeleteCustomFieldRequest,
  res: Response<{ status: 200 }>,
) => {
  req.checkPermissions("manageCustomFields");

  const { id } = req.params;
  const context = getContextFromReq(req);

  const customFields = await context.models.customFields.deleteCustomField(id);

  if (!customFields) {
    throw new Error("Custom field not found");
  }

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /custom-fields/:id
