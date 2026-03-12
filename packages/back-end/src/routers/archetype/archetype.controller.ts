import type { Response } from "express";
import { filterEnvironmentsByFeature } from "shared/util";
import {
  ArchetypeAttributeValues,
  ArchetypeInterface,
} from "shared/types/archetype";
import { FeatureTestResult } from "shared/types/feature";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse, PrivateApiErrorResponse } from "back-end/types/api";
import {
  getEnvironments,
  getContextFromReq,
} from "back-end/src/services/organizations";
import {
  createArchetype,
  deleteArchetypeById,
  getAllArchetypes,
  getArchetypeById,
  updateArchetypeById,
} from "back-end/src/models/ArchetypeModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import {
  evaluateFeature,
  getSavedGroupMap,
  namespacesToMap,
} from "back-end/src/services/features";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

type GetArchetypeResponse = {
  status: 200;
  archetype: ArchetypeInterface[];
};

export const getArchetype = async (
  req: AuthRequest,
  res: Response<GetArchetypeResponse>,
) => {
  const { org, userId } = getContextFromReq(req);

  const archetype = await getAllArchetypes(org.id, userId);

  return res.status(200).json({
    status: 200,
    archetype,
  });
};

type GetArchetypeAndEvalResponse = {
  status: 200;
  archetype: ArchetypeInterface[];
  featureResults:
    | { [key: string]: FeatureTestResult[] }
    | Record<string, never>;
};

export const getArchetypeAndEval = async (
  req: AuthRequest<
    null,
    { id: string; version: string },
    {
      scrubPrerequisites?: string;
      skipRulesWithPrerequisites?: string;
      project?: string;
    }
  >,
  res: Response<GetArchetypeAndEvalResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { id, version } = req.params;
  const {
    scrubPrerequisites: scrubPrerequisitesStr,
    skipRulesWithPrerequisites: skipRulesWithPrerequisitesStr,
    project,
  } = req.query;
  const feature = await getFeature(context, id);

  const scrubPrerequisites =
    scrubPrerequisitesStr === undefined
      ? undefined
      : ["1", "true"].includes(scrubPrerequisitesStr ?? "");
  const skipRulesWithPrerequisites =
    skipRulesWithPrerequisitesStr === undefined
      ? undefined
      : ["1", "true"].includes(skipRulesWithPrerequisitesStr ?? "");

  if (!orgHasPremiumFeature(org, "archetypes")) {
    return res.status(403).json({
      status: 403,
      message: "Organization does not have premium feature: sample users",
    });
  }

  if (!feature) {
    throw new Error("Feature not found");
  }

  const revision = await getRevision({
    context: context,
    organization: org.id,
    featureId: feature.id,
    version: parseInt(version),
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  const archetype = await getAllArchetypes(org.id, userId, project);
  const featureResults: { [key: string]: FeatureTestResult[] } = {};

  if (archetype.length) {
    const groupMap = await getSavedGroupMap(context);
    const experimentMap = await getAllPayloadExperiments(context);
    const allEnvironments = getEnvironments(org);
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const safeRolloutMap =
      await context.models.safeRollout.getAllPayloadSafeRollouts();

    archetype.forEach((arch) => {
      try {
        const attributes = arch.attributes
          ? (JSON.parse(arch.attributes) as ArchetypeAttributeValues)
          : ({} as ArchetypeAttributeValues);
        const result = evaluateFeature({
          feature,
          attributes,
          environments,
          experimentMap,
          groupMap,
          revision,
          scrubPrerequisites,
          skipRulesWithPrerequisites,
          safeRolloutMap,
          namespaces: namespacesToMap(org.settings?.namespaces),
        });

        if (!result) return;
        featureResults[arch.id] = result;
      } catch (e) {
        // not sure what we should do with a json error - should be impossible to get here.
      }
    });
  }

  return res.status(200).json({
    status: 200,
    archetype,
    featureResults,
  });
};

type CreateArchetypeRequest = AuthRequest<{
  name: string;
  description: string;
  owner: string;
  isPublic: boolean;
  attributes: string;
  projects?: string[];
}>;

type CreateArchetypeResponse = {
  status: 200;
  archetype: ArchetypeInterface;
};

export const postArchetype = async (
  req: CreateArchetypeRequest,
  res: Response<CreateArchetypeResponse | PrivateApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { name, attributes, description, isPublic, projects } = req.body;

  if (!orgHasPremiumFeature(org, "archetypes")) {
    return res.status(403).json({
      status: 403,
      message: "Organization does not have premium feature: sample users",
    });
  }

  if (!context.permissions.canCreateArchetype(req.body)) {
    context.permissions.throwPermissionError();
  }

  const archetype = await createArchetype({
    attributes,
    name,
    description,
    owner: userId,
    isPublic,
    organization: org.id,
    projects,
  });

  await req.audit({
    event: "archetype.created",
    entity: {
      object: "archetype",
      id: archetype.id,
      name,
    },
    details: auditDetailsCreate(archetype),
  });

  return res.status(200).json({
    status: 200,
    archetype,
  });
};

type PutArchetypeRequest = AuthRequest<
  {
    name: string;
    description: string;
    owner: string;
    attributes: string;
    isPublic: boolean;
    projects?: string[];
  },
  { id: string }
>;

type PutArchetypeResponse = {
  status: 200;
};

export const putArchetype = async (
  req: PutArchetypeRequest,
  res: Response<
    PutArchetypeResponse | ApiErrorResponse | PrivateApiErrorResponse
  >,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { name, description, isPublic, owner, attributes, projects } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify sample user id");
  }

  if (!orgHasPremiumFeature(org, "archetypes")) {
    return res.status(403).json({
      status: 403,
      message: "Organization does not have premium feature: sample users",
    });
  }

  const updates = {
    attributes,
    name,
    description,
    isPublic,
    owner,
    projects,
  };

  const archetype = await getArchetypeById(id, org.id);

  if (!archetype) {
    throw new Error("Could not find archetype");
  }
  if (!context.permissions.canUpdateArchetype(archetype, updates)) {
    context.permissions.throwPermissionError();
  }

  const changes = await updateArchetypeById(id, org.id, updates);

  const updatedArchetype = { ...archetype, ...changes };

  await req.audit({
    event: "archetype.updated",
    entity: {
      object: "archetype",
      id: updatedArchetype.id,
      name: name,
    },
    details: auditDetailsUpdate(archetype, updatedArchetype),
  });

  return res.status(200).json({
    status: 200,
  });
};

type DeleteArchetypeRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type DeleteArchetypeResponse =
  | {
      status: 200;
    }
  | {
      status: number;
      message: string;
    };

export const deleteArchetype = async (
  req: DeleteArchetypeRequest,
  res: Response<DeleteArchetypeResponse>,
) => {
  const { id } = req.params;
  const context = getContextFromReq(req);
  const { org } = context;

  const archetype = await getArchetypeById(id, org.id);

  if (
    !context.permissions.canDeleteArchetype({
      projects: archetype?.projects || [],
    })
  ) {
    context.permissions.throwPermissionError();
  }

  if (!archetype) {
    res.status(403).json({
      status: 404,
      message: "Sample user not found",
    });
    return;
  }

  if (archetype.organization !== org.id) {
    res.status(403).json({
      status: 403,
      message: "You do not have access to this sample user",
    });
    return;
  }

  await deleteArchetypeById(id, org.id);

  await req.audit({
    event: "archetype.deleted",
    entity: {
      object: "archetype",
      id: id,
      name: archetype.name,
    },
    details: auditDetailsDelete(archetype),
  });

  res.status(200).json({
    status: 200,
  });
};
