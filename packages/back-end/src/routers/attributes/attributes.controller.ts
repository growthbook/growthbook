import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  SDKAttributeFormat,
  SDKAttributeType,
} from "../../../types/organization";
import { updateOrganization } from "../../models/OrganizationModel";
import { auditDetailsUpdate } from "../../services/audit";

export const postAttribute = async (
  req: AuthRequest<{
    property: string;
    datatype: SDKAttributeType;
    projects: string[];
    format: SDKAttributeFormat;
    enum: string;
    hashAttribute: boolean;
  }>,
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
  req: AuthRequest<
    {
      property: string;
      datatype: SDKAttributeType;
      projects: string[];
      format: SDKAttributeFormat;
      enum: string;
      hashAttribute: boolean;
    },
    { id: string }
  >,
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

  // Check permissions for new projects
  req.checkPermissions("manageTargetingAttributes", projects);

  const { org } = getContextFromReq(req);
  const { id } = req.params;

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

  attributeSchema[index] = {
    ...attributeSchema[index],
    property,
    datatype,
    projects,
    format,
    enum: enumValue,
    hashAttribute,
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
