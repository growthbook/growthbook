import type { Response } from "express";
import { SDKAttribute } from "shared/types/organization";
import { DataSourceInterface, UserIdType } from "shared/types/datasource";
import {
  addAttributeToUserIdTypes,
  extractConditionAttributeKeys,
  isValidUserIdTypeName,
  renameAttributeInUserIdTypes,
  USER_ID_TYPE_NAME_RULE,
} from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { parseIdsQuery } from "back-end/src/util/validation";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { addTags, addTagsDiff } from "back-end/src/models/TagModel";
import { getAllFeaturesForGraph } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { syncManagedWarehouseIdentifiersOnAttributeChange } from "back-end/src/services/clickhouse";
import { syncEventForwarderAfterAttributeSchemaChange } from "back-end/src/services/eventForwarder/attributeSync";
import { yieldEventLoop } from "back-end/src/util/yield";
import { logger } from "back-end/src/util/logger";
import { usingFileConfig } from "back-end/src/init/config";
import {
  getDataSourcesByIds,
  getDataSourcesByOrganization,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { getEventForwarderForDatasource } from "back-end/src/services/eventForwarder/config";
import { ReqContext } from "back-end/types/request";
import {
  shouldValidateCustomFieldsOnUpdate,
  validateCustomFieldsForSectionAndProjects,
} from "back-end/src/util/custom-fields";

async function createAttribute(
  req: AuthRequest<unknown>,
  context: ReqContext,
  { tags = [], ...attributeFields }: SDKAttribute,
) {
  const { org } = context;

  const attributeSchema = org.settings?.attributeSchema || [];

  if (attributeSchema.some((a) => a.property === attributeFields.property)) {
    context.throwBadRequestError("An attribute with that name already exists");
  }

  if (attributeFields.customFields !== undefined) {
    await validateCustomFieldsForSectionAndProjects({
      customFieldValues: attributeFields.customFields,
      projects: attributeFields.projects,
      section: "attribute",
      customFieldsModel: context.models.customFields,
    });
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
}

export const postAttribute = async (
  req: AuthRequest<SDKAttribute>,
  res: Response<{ status: number }>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateAttribute({ ...req.body })) {
    context.permissions.throwPermissionError();
  }

  await createAttribute(req, context, req.body);

  return res.status(200).json({
    status: 200,
  });
};

type IdentifierFields = Pick<
  SDKAttribute,
  "property" | "datatype" | "description" | "tags" | "customFields" | "projects"
>;
type IdentifierLink = { id: string; userIdType: string };

// Checks every Data Source before anything is written, so a bad link doesn't
// leave the attribute saved without it.
async function getIdentifierLinkTargets(
  context: ReqContext,
  links: IdentifierLink[],
) {
  if (links.length > 0 && usingFileConfig()) {
    context.throwBadRequestError(
      "Data Sources are managed by config.yml and can't be updated here",
    );
  }

  const datasources = await getDataSourcesByIds(
    context,
    links.map(({ id }) => id),
  );
  return Promise.all(
    links.map(async ({ id, userIdType }) => {
      const datasource = datasources.find((d) => d.id === id);
      if (!datasource) {
        return context.throwNotFoundError(`Data Source ${id} not found`);
      }
      if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
        context.permissions.throwPermissionError();
      }
      if (!isValidUserIdTypeName(userIdType)) {
        context.throwBadRequestError(
          `Invalid identifier type "${userIdType}" for ${datasource.name}. ${USER_ID_TYPE_NAME_RULE}`,
        );
      }
      // These already sync their identifier types from the attribute schema.
      if (await syncsIdentifiersAutomatically(context, datasource)) {
        context.throwBadRequestError(
          `${datasource.name} updates its identifiers automatically`,
        );
      }
      return { datasource, userIdType };
    }),
  );
}

async function syncsIdentifiersAutomatically(
  context: ReqContext,
  datasource: DataSourceInterface,
) {
  return (
    datasource.type === "growthbook_clickhouse" ||
    !!(await getEventForwarderForDatasource(context, datasource.id))
  );
}

// The attribute is already saved when this runs, so it reports the Data
// Sources that fail instead of failing the whole request.
async function updateUserIdTypes(
  context: ReqContext,
  updates: {
    datasource: DataSourceInterface;
    update: (userIdTypes: UserIdType[]) => UserIdType[];
  }[],
): Promise<string[]> {
  const failed: string[] = [];
  for (const { datasource, update } of updates) {
    try {
      await updateDataSource(context, datasource, {
        settings: {
          ...datasource.settings,
          userIdTypes: update(datasource.settings?.userIdTypes ?? []),
        },
      });
    } catch (e) {
      logger.error(e, "Failed to update identifier types in Data Source");
      failed.push(datasource.name);
    }
  }
  return failed;
}

export const postIdentifier = async (
  req: AuthRequest<IdentifierFields & { datasources: IdentifierLink[] }>,
  res: Response<{ status: number; failedDatasources: string[] }>,
) => {
  const { datasources: links, customFields, ...attributeFields } = req.body;
  const { property, description } = attributeFields;
  const context = getContextFromReq(req);

  // Always set, so required custom fields are validated even when none were sent.
  const attribute: SDKAttribute = {
    ...attributeFields,
    customFields: customFields ?? {},
    hashAttribute: true,
  };
  if (!context.permissions.canCreateAttribute(attribute)) {
    context.permissions.throwPermissionError();
  }

  const targets = await getIdentifierLinkTargets(context, links);

  await createAttribute(req, context, attribute);

  const failedDatasources = await updateUserIdTypes(
    context,
    targets.map(({ datasource, userIdType }) => ({
      datasource,
      update: (types) =>
        addAttributeToUserIdTypes(types, userIdType, property, description),
    })),
  );

  return res.status(200).json({
    status: 200,
    failedDatasources,
  });
};

// Links can only be added here. Changing or removing one happens on the Data
// Source, since queries may already depend on it.
export const putIdentifier = async (
  req: AuthRequest<
    IdentifierFields & { previousName?: string; datasources: IdentifierLink[] }
  >,
  res: Response<{ status: number; failedDatasources: string[] }>,
) => {
  const { datasources: links, ...attributeFields } = req.body;
  const { property, previousName, description } = attributeFields;
  const context = getContextFromReq(req);

  const existing = context.org.settings?.attributeSchema?.find(
    (a) => a.property === (previousName ?? property),
  );
  if (!existing) {
    return context.throwNotFoundError("Attribute not found");
  }
  if (!existing.hashAttribute) {
    context.throwBadRequestError(`${existing.property} isn't an identifier`);
  }

  const targets = await getIdentifierLinkTargets(context, links);

  await updateAttribute(req, context, {
    ...attributeFields,
    hashAttribute: true,
  });

  // Links point at the attribute by name, so a rename moves them along.
  const renamedFrom =
    previousName && previousName !== property ? previousName : null;
  const renamed =
    renamedFrom && !usingFileConfig()
      ? await Promise.all(
          (await getDataSourcesByOrganization(context))
            .filter((d) =>
              d.settings?.userIdTypes?.some((t) =>
                t.attributes?.includes(renamedFrom),
              ),
            )
            .map(async (d) =>
              (await syncsIdentifiersAutomatically(context, d)) ? null : d,
            ),
        )
      : [];

  const updates = new Map<
    string,
    {
      datasource: DataSourceInterface;
      update: (userIdTypes: UserIdType[]) => UserIdType[];
    }
  >();
  const failedDatasources: string[] = [];
  for (const datasource of renamed) {
    if (!datasource || !renamedFrom) continue;
    if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
      failedDatasources.push(datasource.name);
      continue;
    }
    updates.set(datasource.id, {
      datasource,
      update: (types) =>
        renameAttributeInUserIdTypes(types, renamedFrom, property),
    });
  }
  for (const { datasource, userIdType } of targets) {
    const rename = updates.get(datasource.id)?.update;
    updates.set(datasource.id, {
      datasource,
      update: (types) =>
        addAttributeToUserIdTypes(
          rename ? rename(types) : types,
          userIdType,
          property,
          description,
        ),
    });
  }

  failedDatasources.push(
    ...(await updateUserIdTypes(context, [...updates.values()])),
  );

  return res.status(200).json({
    status: 200,
    failedDatasources,
  });
};

export const putAttribute = async (
  req: AuthRequest<SDKAttribute & { previousName?: string }>,
  res: Response<{ status: number }>,
) => {
  const context = getContextFromReq(req);

  await updateAttribute(req, context, req.body);

  return res.status(200).json({
    status: 200,
  });
};

async function updateAttribute(
  req: AuthRequest<unknown>,
  context: ReqContext,
  {
    previousName,
    tags,
    ...attributeFields
  }: SDKAttribute & { previousName?: string },
) {
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

  if (
    shouldValidateCustomFieldsOnUpdate({
      existingCustomFieldValues: existing.customFields,
      updatedCustomFieldValues: attributeFields.customFields,
    })
  ) {
    await validateCustomFieldsForSectionAndProjects({
      customFieldValues: attributeFields.customFields,
      // Validate against the projects the attribute will have, not the ones it had.
      projects:
        "projects" in attributeFields
          ? attributeFields.projects
          : existing.projects,
      section: "attribute",
      customFieldsModel: context.models.customFields,
    });
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
}

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
  const attributeKeys = (parseIdsQuery(req.query.ids) ?? []).map(
    decodeURIComponent,
  );

  if (!attributeKeys.length) {
    return res.status(200).json({ status: 200, references: {} });
  }

  const keySet = new Set(attributeKeys);

  // Only conditions are read, so values and ID lists stay in the database
  const [allFeatures, allExperiments, allSavedGroups] = await Promise.all([
    getAllFeaturesForGraph(context),
    getAllExperiments(context, {}),
    context.models.savedGroups.getAllWithoutValues(),
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

  for (let i = 0; i < allExperiments.length; i++) {
    await yieldEventLoop(i);
    const experiment = allExperiments[i];
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

  for (let i = 0; i < allSavedGroups.length; i++) {
    await yieldEventLoop(i);
    const group = allSavedGroups[i];
    if (group.type !== "condition" || group.archived) continue;
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
