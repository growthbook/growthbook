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
    projects,
    sections,
  } = req.body;

  const context = getContextFromReq(req);
  if (!context.permissions.canManageCustomFields()) {
    context.permissions.throwPermissionError();
  }

  if (!id) {
    return context.throwBadRequestError("Must specify field key");
  }

  if (!id.match(/^[a-z0-9_-]+$/)) {
    return context.throwBadRequestError(
      "Custom field keys can only include lowercase letters, numbers, hyphens, and underscores.",
    );
  }
  const existingFields = await context.models.customFields.getCustomFields();

  // check if this name already exists for any overlapping section:
  if (existingFields && sections?.length) {
    const existingCustomField = existingFields.fields.find(
      (field) =>
        field.name === name &&
        field.sections?.some((s) => sections.includes(s)),
    );
    if (existingCustomField) {
      return context.throwBadRequestError(
        "Custom field name already exists for one or more of the selected sections",
      );
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
    projects,
    sections: sections ?? ["feature"],
  });

  if (!updated) {
    context.throwInternalServerError("Custom field not created");
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
    projects?: string[];
    sections?: CustomFieldSection[];
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
  const context = getContextFromReq(req);

  const {
    name,
    description,
    placeholder,
    defaultValue,
    type,
    values,
    required,
    projects,
    sections,
  } = req.body;
  const { id } = req.params;

  if (!id) {
    return context.throwBadRequestError("Must specify custom field id");
  }

  req.checkPermissions("manageCustomFields");

  const existingField =
    await context.models.customFields.getCustomFieldByFieldId(id);

  if (!existingField) {
    return context.throwNotFoundError("Custom field not found");
  }

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
      projects,
      sections: sections ?? existingField.sections ?? ["feature"],
    },
  );

  if (!newCustomFields) {
    context.throwInternalServerError("Custom field not updated");
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
  { index?: number }
>;

/**
 * DELETE /custom-fields/:id
 * Delete one custom-field resource by ID. For legacy data with duplicate ids,
 * pass ?index=N as tiebreaker; if index doesn't match, the first occurrence
 * is deleted.
 * @param req
 * @param res
 */
export const deleteCustomField = async (
  req: DeleteCustomFieldRequest,
  res: Response<{ status: 200 }>,
) => {
  req.checkPermissions("manageCustomFields");

  const { id } = req.params;
  const { index } = req.query;
  const context = getContextFromReq(req);

  const customFields = await context.models.customFields.deleteCustomField(
    id,
    index,
  );

  if (!customFields) {
    return context.throwNotFoundError("Custom field not found");
  }

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /custom-fields/:id
