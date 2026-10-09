import { z } from "zod";
import {
  ApiPopulation,
  apiCreatePopulationBody,
  apiUpdatePopulationBody,
  PopulationInterface,
  PopulationStep,
  populationApiSpec,
  populationValidator,
} from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import {
  getPopulationFactTableIds,
  getPopulationRuleViolations,
} from "shared/populations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import {
  resolveOwnerForCreate,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";
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
  },
});

export class PopulationModel extends BaseClass {
  protected canRead(doc: PopulationInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }
  protected canCreate(doc: PopulationInterface): boolean {
    return this.context.permissions.canCreatePopulation(doc);
  }
  protected canUpdate(
    existing: PopulationInterface,
    updates: UpdateProps<PopulationInterface>,
  ): boolean {
    return this.context.permissions.canUpdatePopulation(existing, updates);
  }
  protected canDelete(doc: PopulationInterface): boolean {
    return this.context.permissions.canDeletePopulation(doc);
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
    const { owner, steps, ...body } = apiUpdatePopulationBody.parse(rawBody);
    let resolvedOwner: string | undefined;
    if (owner !== undefined) {
      resolvedOwner = await resolveOwnerToUserId(owner, this.context, {
        strict: true,
      });
      if (!resolvedOwner) {
        this.context.throwBadRequestError("`owner` cannot be empty.");
      }
    }
    return {
      ...body,
      ...(resolvedOwner && { owner: resolvedOwner }),
      ...(steps && { steps: withStepDefaults(steps) }),
    };
  }

  protected toApiInterface(doc: PopulationInterface): ApiPopulation {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      projects: doc.projects ?? [],
      owner: doc.owner,
      name: doc.name,
      description: doc.description,
      datasource: doc.datasource,
      userIdTypes: doc.userIdTypes,
      steps: doc.steps,
    };
  }
}
