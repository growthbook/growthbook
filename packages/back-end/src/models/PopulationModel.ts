import {
  ApiPopulation,
  apiCreatePopulationBody,
  PopulationInterface,
  populationValidator,
} from "shared/validators";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { populationApiSpec } from "back-end/src/api/specs/population.spec";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTablesByIds } from "back-end/src/models/FactTableModel";
import { resolveOwnerForCreate } from "back-end/src/services/owner";
import { MakeModelClass } from "./BaseModel";

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

  protected async customValidation(doc: PopulationInterface): Promise<void> {
    const datasource = await getDataSourceById(this.context, doc.datasource);
    if (!datasource) {
      this.context.throwBadRequestError(
        `Data Source ${doc.datasource} not found`,
      );
    }

    if (doc.steps[0]?.windowSettings.type === "conversion") {
      this.context.throwBadRequestError(
        "The first step cannot use a conversion window",
      );
    }

    const factTableIds = [
      ...new Set(doc.steps.map((step) => step.source.factTableId)),
    ];
    const factTables = await getFactTablesByIds(this.context, factTableIds);
    const factTableMap = new Map(factTables.map((f) => [f.id, f]));

    for (const factTableId of factTableIds) {
      const factTable = factTableMap.get(factTableId);
      if (!factTable) {
        this.context.throwBadRequestError(
          `Fact table ${factTableId} not found`,
        );
      }
      if (factTable.datasource !== doc.datasource) {
        this.context.throwBadRequestError(
          `Fact table ${factTableId} is not in Data Source ${doc.datasource}`,
        );
      }
      const missing = doc.userIdTypes.filter(
        (t) => !factTable.userIdTypes.includes(t),
      );
      if (missing.length) {
        this.context.throwBadRequestError(
          `Fact table ${factTableId} does not support identifier types: ${missing.join(", ")}`,
        );
      }
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
      steps: body.steps.map((step) => ({
        ...step,
        rowFilters: step.rowFilters ?? [],
        windowSettings: step.windowSettings ?? {
          type: "",
          delayValue: 0,
          delayUnit: "days",
          windowValue: 0,
          windowUnit: "days",
        },
      })),
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
