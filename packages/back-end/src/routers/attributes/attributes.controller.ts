import type { Response } from "express";
import { SDKAttribute } from "shared/types/organization";
import { extractConditionAttributeKeys } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { addTags, addTagsDiff } from "back-end/src/models/TagModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { syncManagedWarehouseIdentifiersOnAttributeChange } from "back-end/src/services/clickhouse";
import { syncEventForwarderAfterAttributeSchemaChange } from "back-end/src/services/eventForwarder/attributeSync";
import { yieldEventLoop } from "back-end/src/util/yield";
export const postAttribute = async (
  req: AuthRequest<SDKAttribute>,
  res: Response<{ status: number }>,
) => {
  const { tags = [], ...attributeFields } = req.body;
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateAttribute({ ...req.body })) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;

  const attributeSchema = org.settings?.attributeSchema || [];

  if (attributeSchema.some((a) => a.property === attributeFields.property)) {
    context.throwBadRequestError("An attribute with that name already exists");
  }

  if (tags.length > 0) {
    await addTags(org.id, tags);
  }

  const newAttribute: SDKAttribute = {
    ...attributeFields,
    ...(tags.length > 0 && { tags }),
  };

  const updatedAttributeSchema = [...attributeSchema, newAttribute];

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      attributeSchema: updatedAttributeSchema,
    },
  });

  await syncManagedWarehouseIdentifiersOnAttributeChange(
    context,
    updatedAttributeSchema,
  );

  await syncEventForwarderAfterAttributeSchemaChange(context, {
    attributeSchema: updatedAttributeSchema,
  });

  await req.audit({
    event: "attribute.create",
    entity: {
      object: "organization",
      id: org.id,
    },
    details: auditDetailsUpdate(
      { settings: { attributeSchema } },
      { settings: { attributeSchema: updatedAttributeSchema } },
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
  const { previousName, tags, ...attributeFields } = req.body;
  const context = getContextFromReq(req);
  const { org } = context;

  const attributeSchema = org.settings?.attributeSchema || [];

  // If the name is being changed, we need to access the attribute via its previous name
  const index = attributeSchema.findIndex(
    (a) =>
      a.property === (previousName ? previousName : attributeFields.property),
  );

  if (index === -1) {
    context.throwNotFoundError("Attribute not found");
  }

  const existing = attributeSchema[index];
  // Only pass `projects` when the client actually sent it — passing
  // `{ projects: undefined }` would be interpreted as a request to scope the
  // attribute globally and incorrectly deny project-scoped users.
  if (
    !context.permissions.canUpdateAttribute(
      existing,
      "projects" in attributeFields
        ? { projects: attributeFields.projects }
        : {},
    )
  ) {
    context.permissions.throwPermissionError();
  }

  if (
    previousName &&
    attributeFields.property !== previousName &&
    attributeSchema.some((a) => a.property === attributeFields.property)
  ) {
    // If the name is being changed, check if the new name already exists
    context.throwBadRequestError("An attribute with that name already exists");
  }

  if (tags !== undefined) {
    await addTagsDiff(org.id, existing.tags || [], tags);
  }

  // Only merge fields the client actually sent — absent keys preserve the
  // existing value, avoiding the BSON `undefined → null` round trip.
  attributeSchema[index] = {
    ...attributeSchema[index],
    ...attributeFields,
    ...(tags !== undefined && { tags: tags.length > 0 ? tags : undefined }),
  };

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      attributeSchema,
    },
  });

  await syncManagedWarehouseIdentifiersOnAttributeChange(
    context,
    attributeSchema,
  );

  await syncEventForwarderAfterAttributeSchemaChange(context, {
    attributeSchema,
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
    context.throwNotFoundError("Attribute not found");
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

  await syncManagedWarehouseIdentifiersOnAttributeChange(context, updatedArr);

  await syncEventForwarderAfterAttributeSchemaChange(context, {
    attributeSchema: updatedArr,
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

type AttributeRef = { id: string; name: string; project?: string };
type AttributeRefExperiment = {
  id: string;
  name: string;
  project?: string;
  projects?: string[];
};
type AttributeRefGroup = { id: string; groupName: string; projects?: string[] };
type AttributeReferencesMap = Record<
  string,
  {
    features: AttributeRef[];
    experiments: AttributeRefExperiment[];
    savedGroups: AttributeRefGroup[];
  }
>;

/**
 * GET /attribute/references?ids=attr1,attr2
 * Returns features, experiments, and condition groups that reference each requested attribute key.
 * Walks rule/phase condition JSON and checks hashAttribute on experiments.
 */
export const getAttributeReferences = async (
  req: AuthRequest<null, Record<string, never>, { ids?: string }>,
  res: Response<{ status: 200; references: AttributeReferencesMap }>,
) => {
  const context = getContextFromReq(req);
  const attributeKeys = req.query.ids
    ? req.query.ids.split(",").filter(Boolean)
    : [];

  if (!attributeKeys.length) {
    return res.status(200).json({ status: 200, references: {} });
  }

  const keySet = new Set(attributeKeys);

  const [allFeatures, allExperiments, allSavedGroups] = await Promise.all([
    getAllFeatures(context, {}),
    getAllExperiments(context, {}),
    context.models.savedGroups.getAll(),
  ]);

  // { attributeKey -> { featureId -> { id, name, project } } }
  const featureRefs = new Map<string, Map<string, AttributeRef>>();
  const experimentRefs = new Map<string, Map<string, AttributeRefExperiment>>();
  const savedGroupRefs = new Map<string, Map<string, AttributeRefGroup>>();

  for (const key of attributeKeys) {
    featureRefs.set(key, new Map());
    experimentRefs.set(key, new Map());
    savedGroupRefs.set(key, new Map());
  }

  for (let i = 0; i < allFeatures.length; i++) {
    await yieldEventLoop(i);
    const feature = allFeatures[i];
    for (const rule of feature.rules ?? []) {
      try {
        const parsed = JSON.parse(rule.condition ?? "{}");
        for (const nodeKey of extractConditionAttributeKeys(parsed)) {
          if (keySet.has(nodeKey)) {
            featureRefs.get(nodeKey)!.set(feature.id, {
              id: feature.id,
              name: feature.id,
              project: feature.project,
            });
          }
        }
      } catch {
        // ignore unparseable conditions
      }
    }
  }

  for (const experiment of allExperiments) {
    const addExp = (key: string) => {
      if (!keySet.has(key)) return;
      experimentRefs.get(key)!.set(experiment.id, {
        id: experiment.id,
        name: experiment.name,
        project: (experiment as { project?: string }).project,
        projects: (experiment as { projects?: string[] }).projects,
      });
    };

    addExp(experiment.hashAttribute);

    const phase = experiment.phases?.slice(-1)?.[0];
    try {
      const parsed = JSON.parse(phase?.condition ?? "{}");
      for (const nodeKey of extractConditionAttributeKeys(parsed)) {
        addExp(nodeKey);
      }
    } catch {
      // ignore
    }
  }

  for (const group of allSavedGroups) {
    if (group.type !== "condition") continue;
    try {
      const parsed = JSON.parse(group.condition ?? "{}");
      for (const nodeKey of extractConditionAttributeKeys(parsed)) {
        if (keySet.has(nodeKey)) {
          savedGroupRefs.get(nodeKey)!.set(group.id, {
            id: group.id,
            groupName: group.groupName,
            projects: group.projects,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  const references: AttributeReferencesMap = {};
  for (const key of attributeKeys) {
    references[key] = {
      features: Array.from(featureRefs.get(key)!.values()),
      experiments: Array.from(experimentRefs.get(key)!.values()),
      savedGroups: Array.from(savedGroupRefs.get(key)!.values()),
    };
  }

  return res.status(200).json({ status: 200, references });
};
