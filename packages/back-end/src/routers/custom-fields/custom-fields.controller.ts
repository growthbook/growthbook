import type { Response } from "express";
import {
  CustomFieldSection,
  CustomFieldsInterface,
  CustomFieldTypes,
  CreateCustomFieldProps,
} from "shared/types/custom-fields";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { convertCustomFieldValue } from "back-end/src/services/customFieldMigration";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { FeatureModel } from "back-end/src/models/FeatureModel";
import { ExperimentModel } from "back-end/src/models/ExperimentModel";

/**
 * Migrate custom field values in features and experiments after a type change
 */
async function migrateCustomFieldValues(
  context: ReqContext | ApiReqContext,
  fieldId: string,
  section: CustomFieldSection,
  fromType: CustomFieldTypes,
  toType: CustomFieldTypes,
  fromValues?: string,
  toValues?: string,
) {
  if (section === "feature") {
    // Migrate feature custom field values
    const features = await FeatureModel.find({
      organization: context.org.id,
      [`customFields.${fieldId}`]: { $exists: true },
    });

    for (const feature of features) {
      const oldValue = feature.customFields?.[fieldId];
      if (oldValue === null || oldValue === undefined) continue;

      const newValue = convertCustomFieldValue(
        oldValue,
        fromType,
        toType,
        toValues,
      );

      if (newValue === null) {
        // Scrub the value
        await FeatureModel.updateOne(
          { _id: feature._id },
          { $unset: { [`customFields.${fieldId}`]: "" } },
        );
      } else if (newValue !== oldValue) {
        // Convert the value
        await FeatureModel.updateOne(
          { _id: feature._id },
          { $set: { [`customFields.${fieldId}`]: newValue } },
        );
      }
    }
  } else if (section === "experiment") {
    // Migrate experiment custom field values
    const experiments = await ExperimentModel.find({
      organization: context.org.id,
      [`customFields.${fieldId}`]: { $exists: true },
    });

    for (const experiment of experiments) {
      const oldValue = experiment.customFields?.[fieldId];
      if (oldValue === null || oldValue === undefined) continue;

      const newValue = convertCustomFieldValue(
        oldValue,
        fromType,
        toType,
        toValues,
      );

      if (newValue === null) {
        // Scrub the value
        await ExperimentModel.updateOne(
          { _id: experiment._id },
          { $unset: { [`customFields.${fieldId}`]: "" } },
        );
      } else if (newValue !== oldValue) {
        // Convert the value
        await ExperimentModel.updateOne(
          { _id: experiment._id },
          { $set: { [`customFields.${fieldId}`]: newValue } },
        );
      }
    }
  }
}

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
    return context.throwBadRequestError("Must specify field key");
  }

  if (!id.match(/^[a-z0-9_-]+$/)) {
    return context.throwBadRequestError(
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
      return context.throwBadRequestError(
        "Custom field name already exists for this section",
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
    index: !!index,
    projects,
    section,
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
  const context = getContextFromReq(req);

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
    return context.throwBadRequestError("Must specify custom field id");
  }

  req.checkPermissions("manageCustomFields");

  // Get the existing custom field to detect type changes
  const existingField =
    await context.models.customFields.getCustomFieldByFieldId(id);

  if (!existingField) {
    return context.throwNotFoundError("Custom field not found");
  }

  const typeChanged = existingField.type !== type;
  const valuesChanged =
    (existingField.type === "enum" || existingField.type === "multiselect") &&
    existingField.values !== values;

  // Update the custom field definition
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
    context.throwInternalServerError("Custom field not updated");
  }

  // If type or enum values changed, migrate existing custom field values
  if (typeChanged || valuesChanged) {
    await migrateCustomFieldValues(
      context,
      id,
      section,
      existingField.type,
      type,
      existingField.values,
      values,
    );
  }

  // Trigger cache refresh since custom field definitions changed
  queueSDKPayloadRefresh({
    context,
    payloadKeys: [],
    sdkConnections: [],
    auditContext: {
      event: "updated",
      model: "custom-field",
      id,
    },
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
    return context.throwNotFoundError("Custom field not found");
  }

  // Trigger cache refresh since custom field deleted
  queueSDKPayloadRefresh({
    context,
    payloadKeys: [],
    sdkConnections: [],
    auditContext: {
      event: "deleted",
      model: "custom-field",
      id,
    },
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /custom-fields/:id
