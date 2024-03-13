import type { Response } from "express";
import { getContextFromReq } from "@/src/services/organizations";
import { auditDetailsUpdate } from "@/src/services/audit";
import { SDKAttribute } from "@/types/organization";
import { updateOrganization } from "@/src/models/OrganizationModel";
import { AuthRequest } from "@/src/types/AuthRequest";

export const postAttribute = async (
  req: AuthRequest<SDKAttribute>,
  res: Response<{ status: number }>
) => {
  const {
    property,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
  } = req.body;
  req.checkPermissions("manageTargetingAttributes", projects);

  const { org } = getContextFromReq(req);

  const attributeSchema = org.settings?.attributeSchema || [];

  if (attributeSchema.some((a) => a.property === property)) {
    throw new Error("An attribute with that name already exists");
  }

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      attributeSchema: [
        ...attributeSchema,
        {
          property,
          datatype,
          projects,
          format,
          enum: enumValue,
          hashAttribute,
        },
      ],
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
          attributeSchema: [
            ...attributeSchema,
            {
              property,
              datatype,
              projects,
              format,
              enum: enumValue,
              hashAttribute,
            },
          ],
        },
      }
    ),
  });
  return res.status(200).json({
    status: 200,
  });
};

export const putAttribute = async (
  req: AuthRequest<SDKAttribute & { previousName?: string }>,
  res: Response<{ status: number }>
) => {
  const {
    property,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
    archived,
    previousName,
  } = req.body;
  const { org } = getContextFromReq(req);

  const attributeSchema = org.settings?.attributeSchema || [];

  // If the name is being changed, we need to access the attribute via its previous name
  const index = attributeSchema.findIndex(
    (a) => a.property === (previousName ? previousName : property)
  );

  if (index === -1) {
    throw new Error("Attribute not found");
  }

  // Check permissions for new projects
  req.checkPermissions("manageTargetingAttributes", projects);

  // Check permissions on existing project list
  req.checkPermissions(
    "manageTargetingAttributes",
    attributeSchema[index].projects
  );

  // If the name is being changed, check if the new name already exists
  if (
    previousName &&
    property !== previousName &&
    attributeSchema.some((a) => a.property === property)
  ) {
    throw new Error("An attribute with that name already exists");
  }

  // Update the attribute
  attributeSchema[index] = {
    ...attributeSchema[index],
    property,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
    archived,
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
      }
    ),
  });
  return res.status(200).json({
    status: 200,
  });
};

export const deleteAttribute = async (
  req: AuthRequest<{ id: string }>,
  res: Response<{ status: number }>
) => {
  const { org } = getContextFromReq(req);
  const { id } = req.body;

  const attributeSchema = org.settings?.attributeSchema || [];

  const index = attributeSchema.findIndex((a) => a.property === id);

  if (index === -1) {
    throw new Error("Attribute not found");
  }

  // Check permissions on existing project list
  req.checkPermissions(
    "manageTargetingAttributes",
    attributeSchema[index].projects
  );

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
      }
    ),
  });
  return res.status(200).json({
    status: 200,
  });
};
