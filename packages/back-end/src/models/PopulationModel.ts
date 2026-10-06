import { z } from "zod";
import {
  ApiPopulation,
  apiCreatePopulationBody,
  apiUpdatePopulationBody,
  cancelPopulationRefreshEndpoint,
  PopulationInterface,
  PopulationStep,
  populationApiSpec,
  populationValidator,
  refreshPopulationEndpoint,
} from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import {
  getPopulationFactTableIds,
  getPopulationRuleViolations,
} from "shared/populations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import { resolveOwnerForCreate } from "back-end/src/services/owner";
import {
  cancelPopulationRefresh,
  refreshPopulation,
} from "back-end/src/services/populations";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import { toApiPopulationSnapshot } from "./PopulationSnapshotModel";
import { MakeModelClass } from "./BaseModel";

function withStepDefaults(
  steps: NonNullable<z.infer<typeof apiUpdatePopulationBody>["steps"]>,
): PopulationStep[] {
  return steps.map((step) => ({
    ...step,
    rowFilters: step.rowFilters ?? [],
    windowSettings: step.windowSettings ?? {
      type: "",
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
  }));
}

const BaseClass = MakeModelClass({
  schema: populationValidator,
  collectionName: "populations",
  idPrefix: "pop_",
  auditLog: {
    entity: "population",
    createEvent: "population.create",
    updateEvent: "population.update",
    deleteEvent: "population.delete",
  },
  globallyUniquePrimaryKeys: false,
  readonlyFields: ["datasource"],
  apiConfig: {
    modelKey: "populations",
    openApiSpec: populationApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...refreshPopulationEndpoint,
        reqHandler: async (
          req,
        ): Promise<
          z.infer<typeof refreshPopulationEndpoint.zodReturnObject>
        > => {
          const population: PopulationInterface | null =
            await req.context.models.populations.getById(req.params.id);
          if (!population) {
            return req.context.throwNotFoundError(
              `Population ${req.params.id} not found`,
            );
          }
          const snapshot = await refreshPopulation(req.context, population);
          return { populationSnapshot: toApiPopulationSnapshot(snapshot) };
        },
      }),
      defineCustomApiHandler({
        ...cancelPopulationRefreshEndpoint,
        reqHandler: async (
          req,
        ): Promise<
          z.infer<typeof cancelPopulationRefreshEndpoint.zodReturnObject>
        > => {
          const population: PopulationInterface | null =
            await req.context.models.populations.getById(req.params.id);
          if (!population) {
            return req.context.throwNotFoundError(
              `Population ${req.params.id} not found`,
            );
          }
          return {
            canceled: await cancelPopulationRefresh(req.context, population),
          };
        },
      }),
    ],
  },
});

export class PopulationModel extends BaseClass {
  protected canRead(doc: PopulationInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canCreate(doc: PopulationInterface): boolean {
    return this.context.permissions.canCreateSegment(doc);
  }
  protected canUpdate(
    existing: PopulationInterface,
    _updates: UpdateProps<PopulationInterface>,
    newDoc: PopulationInterface,
  ): boolean {
    return this.context.permissions.canUpdateSegment(existing, newDoc);
  }
  protected canDelete(doc: PopulationInterface): boolean {
    return this.context.permissions.canDeleteSegment(doc);
  }

  protected async afterDelete(doc: PopulationInterface): Promise<void> {
    await this.context.models.populationSnapshots.deleteForPopulation(doc.id);
  }

  protected async customValidation(doc: PopulationInterface): Promise<void> {
    const datasource = await getDataSourceById(this.context, doc.datasource);
    if (!datasource) {
      this.context.throwBadRequestError(
        `Data Source ${doc.datasource} not found.`,
      );
    }

    const factTables = await getFactTablesByIds(
      this.context,
      getPopulationFactTableIds(doc.steps),
    );
    const violations = getPopulationRuleViolations({
      datasource: doc.datasource,
      userIdTypes: doc.userIdTypes,
      steps: doc.steps,
      factTables,
    });
    if (violations.length) {
      this.context.throwBadRequestError(violations.join(" "));
    }
  }

  protected async processApiCreateBody(
    rawBody: unknown,
  ): Promise<CreateProps<PopulationInterface>> {
    const body = apiCreatePopulationBody.parse(rawBody);
    return {
      ...body,
      description: body.description ?? "",
      owner: await resolveOwnerForCreate(body.owner, this.context, {
        strict: true,
      }),
      projects: body.projects ?? [],
      steps: withStepDefaults(body.steps),
    };
  }

  protected async processApiUpdateBody(
    rawBody: unknown,
  ): Promise<UpdateProps<PopulationInterface>> {
    const { steps, ...body } = apiUpdatePopulationBody.parse(rawBody);
    return {
      ...body,
      ...(steps && { steps: withStepDefaults(steps) }),
    };
  }

  protected toApiInterface(doc: PopulationInterface): ApiPopulation {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      projects: doc.projects,
      owner: doc.owner,
      name: doc.name,
      description: doc.description,
      datasource: doc.datasource,
      userIdTypes: doc.userIdTypes,
      steps: doc.steps,
    };
  }
}
