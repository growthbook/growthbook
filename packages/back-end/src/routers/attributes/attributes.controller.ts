import type { Response } from "express";
import { SDKAttribute } from "shared/types/organization";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";

export const postAttribute = async (
  req: AuthRequest<SDKAttribute>,
  res: Response<{ status: number }>,
) => {
  const {
    property,
    description,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
    disableEqualityConditions,
  } = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateAttribute({ ...req.body })) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;

  const attributeSchema = org.settings?.attributeSchema || [];

  if (attributeSchema.some((a) => a.property === property)) {
    throw new Error("An attribute with that name already exists");
  }

  const newAttribute: SDKAttribute = {
    property,
    description,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
    disableEqualityConditions,
  };

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      attributeSchema: [...attributeSchema, newAttribute],
    },
  });

  await req.audit({
    event: "attribute.create",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { attributeSchema } },
      {
        settings: {
          attributeSchema: [...attributeSchema, newAttribute],
        },
      },
    ),
  });
  return res.status(200).json({
    status: 200,
  });
};

export const putAttribute = async (
  req: AuthRequest<SDKAttribute & { previousName?: string }>,
  res: Response<{ status: number }>,
) => {
  const {
    property,
    description,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
    archived,
    disableEqualityConditions,
    previousName,
  } = req.body;
  const context = getContextFromReq(req);
  const { org } = context;

  const attributeSchema = org.settings?.attributeSchema || [];

  // If the name is being changed, we need to access the attribute via its previous name
  const index = attributeSchema.findIndex(
    (a) => a.property === (previousName ? previousName : property),
  );

  if (index === -1) {
    throw new Error("Attribute not found");
  }

  const existing = attributeSchema[index];
  if (!context.permissions.canUpdateAttribute(existing, { projects })) {
    context.permissions.throwPermissionError();
  }

  if (
    previousName &&
    property !== previousName &&
    attributeSchema.some((a) => a.property === property)
  ) {
    // If the name is being changed, check if the new name already exists
    throw new Error("An attribute with that name already exists");
  }

  // Update the attribute
  attributeSchema[index] = {
    ...attributeSchema[index],
    property,
    description,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
    archived,
    disableEqualityConditions,
  };

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      attributeSchema,
    },
  });

  await req.audit({
    event: "attribute.update",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { attributeSchema: org.settings?.attributeSchema || [] } },
      {
        settings: {
          attributeSchema,
        },
      },
    ),
  });
  return res.status(200).json({
    status: 200,
  });
};

export const deleteAttribute = async (
  req: AuthRequest<{ id: string }>,
  res: Response<{ status: number }>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.body;

  const attributeSchema = org.settings?.attributeSchema || [];

  const index = attributeSchema.findIndex((a) => a.property === id);

  if (index === -1) {
    throw new Error("Attribute not found");
  }

  // Check permissions on existing project list
  if (!context.permissions.canDeleteAttribute(attributeSchema[index])) {
    context.permissions.throwPermissionError();
  }

  const updatedArr = attributeSchema.filter((a) => a.property !== id);

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      attributeSchema: updatedArr,
    },
  });

  await req.audit({
    event: "attribute.delete",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { attributeSchema: org.settings?.attributeSchema || [] } },
      {
        settings: {
          attributeSchema: updatedArr,
        },
      },
    ),
  });
  return res.status(200).json({
    status: 200,
  });
};
