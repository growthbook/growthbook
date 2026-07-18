import type { Response } from "express";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { ProjectInterface } from "shared/types/project";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { SoftWarningError } from "back-end/src/util/errors";
import { PrivateApiErrorResponse } from "back-end/types/api";
import {
  deleteDemoResources,
  isLegacyDemoSeed,
  seedDemoResources,
} from "back-end/src/services/demo-datasource";
import { cleanupProjectReferences } from "back-end/src/services/projects";

// region Permission checks

function checkCanCreateDemoResources(
  req: AuthRequest,
  context: ReqContext,
  demoProjId: string,
): void {
  if (!context.permissions.canCreateProjects()) {
    context.permissions.throwPermissionError();
  }
  req.checkPermissions("createAnalyses", "");

  if (
    !context.permissions.canCreateFactMetric({ projects: [demoProjId] }) ||
    !context.permissions.canCreateFactTable({ projects: [demoProjId] }) ||
    !context.permissions.canCreateDataSource({
      projects: [demoProjId],
      type: "postgres",
    })
  ) {
    context.permissions.throwPermissionError();
  }
}

function checkCanDeleteDemoResources(
  context: ReqContext,
  demoProjId: string,
): void {
  if (
    !context.permissions.canDeleteDataSource({ projects: [demoProjId] }) ||
    !context.permissions.canDeleteFactMetric({ projects: [demoProjId] }) ||
    !context.permissions.canDeleteFactTable({ projects: [demoProjId] }) ||
    !context.permissions.canDeleteFeature({ project: demoProjId }) ||
    !context.permissions.canDeleteExperiment({ project: demoProjId })
  ) {
    context.permissions.throwPermissionError();
  }
}

// endregion Permission checks

// region POST /demo-datasource-project

type CreateDemoDatasourceProjectRequest = AuthRequest;

type CreateDemoDatasourceProjectResponse = {
  status: 200;
  project: ProjectInterface;
  experimentId: string;
};

/**
 * POST /demo-datasource-project
 * Create the sample data project and its seeded resources. Idempotent: any
 * seeded resource that already exists is left alone, so re-posting heals a
 * partial seed.
 * @param req
 * @param res
 */
export const postDemoDatasourceProject = async (
  req: CreateDemoDatasourceProjectRequest,
  res: Response<
    CreateDemoDatasourceProjectResponse | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const context = getContextFromReq(req);
  const demoProjId = getDemoDatasourceProjectIdForOrganization(context.org.id);

  checkCanCreateDemoResources(req, context, demoProjId);

  const existingDemoProject: ProjectInterface | null =
    await context.models.projects.getById(demoProjId);

  if (existingDemoProject && (await isLegacyDemoSeed(context))) {
    const existingExperiments = await getAllExperiments(context, {
      project: existingDemoProject.id,
      includeArchived: true,
    });

    res.status(200).json({
      status: 200,
      project: existingDemoProject,
      experimentId: existingExperiments[0]?.id || "",
    });
    return;
  }

  try {
    const { project, experiment } = await seedDemoResources(context);

    res.status(200).json({
      status: 200,
      project,
      experimentId: experiment.id,
    });
  } catch (e) {
    if (e instanceof SoftWarningError) throw e;
    res.status(500).json({
      status: 500,
      message: `Failed to create demo datasource and project with message: ${e.message}`,
    });
  }
  return;
};

// endregion POST /demo-datasource-project

// region DELETE /demo-datasource-project

type DeleteDemoDatasourceProjectRequest = AuthRequest;

type DeleteDemoDatasourceProjectResponse = {
  status: 200;
};

/**
 * DELETE /demo-datasource-project
 * Delete the seeded sample resources and the Sample Data project. Resources
 * the user created are kept: any reference to the project is removed and they
 * fall back to "All Projects".
 * @param req
 * @param res
 */
export const deleteDemoDatasourceProject = async (
  req: DeleteDemoDatasourceProjectRequest,
  res: Response<
    DeleteDemoDatasourceProjectResponse | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const context = getContextFromReq(req);
  const demoProjId = getDemoDatasourceProjectIdForOrganization(context.org.id);

  if (!context.permissions.canDeleteProject(demoProjId)) {
    context.permissions.throwPermissionError();
  }
  checkCanDeleteDemoResources(context, demoProjId);

  await deleteDemoResources(context);

  const failedToCleanUp = await cleanupProjectReferences(context, demoProjId);

  if (await context.models.projects.getById(demoProjId)) {
    await context.models.projects.deleteById(demoProjId);
  }

  if (failedToCleanUp.length > 0) {
    res.status(400).json({
      status: 400,
      message:
        `Sample data deleted, but failed to remove the Project from the following resources: ` +
        failedToCleanUp.join(", "),
    });
    return;
  }

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /demo-datasource-project

// region POST /demo-datasource-project/reset

type ResetDemoDatasourceProjectRequest = AuthRequest;

type ResetDemoDatasourceProjectResponse = {
  status: 200;
  project: ProjectInterface;
  experimentId: string;
};

/**
 * POST /demo-datasource-project/reset
 * Restore the seeded sample resources to their original state by deleting
 * whichever still exist and re-seeding. User-created resources are not
 * touched and the project is kept.
 * @param req
 * @param res
 */
export const postResetDemoDatasourceProject = async (
  req: ResetDemoDatasourceProjectRequest,
  res: Response<
    ResetDemoDatasourceProjectResponse | PrivateApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const context = getContextFromReq(req);
  const demoProjId = getDemoDatasourceProjectIdForOrganization(context.org.id);

  checkCanCreateDemoResources(req, context, demoProjId);
  checkCanDeleteDemoResources(context, demoProjId);

  try {
    await deleteDemoResources(context);
    const { project, experiment } = await seedDemoResources(context);

    res.status(200).json({
      status: 200,
      project,
      experimentId: experiment.id,
    });
  } catch (e) {
    if (e instanceof SoftWarningError) throw e;
    res.status(500).json({
      status: 500,
      message: `Failed to reset sample data with message: ${e.message}`,
    });
  }
  return;
};

// endregion POST /demo-datasource-project/reset
