import { CreateProps, UpdateProps } from "shared/types/base-model";
import { PopulationInterface } from "shared/types/population";
import {
  ApiPopulation,
  apiCreatePopulationBody,
  apiUpdatePopulationBody,
  fromApiPopulationStep,
  populationValidator,
  toApiPopulationStep,
} from "shared/validators";
import { populationApiSpec } from "back-end/src/api/specs/population.spec";
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
  defaultValues: {
    owner: "",
    description: "",
    projects: [],
    userIdTypes: [],
  },
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        datasource: 1,
      },
    },
  ],
  apiConfig: {
    modelKey: "populations",
    openApiSpec: populationApiSpec,
  },
});

export class PopulationModel extends BaseClass {
  protected canRead(doc: PopulationInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(
      doc.projects || [],
    );
  }

  // Reuse segment permissions until Populations-specific atoms exist.
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
    doc.steps.forEach((step, index) => {
      if (index === 0 && step.windowSettings.type === "conversion") {
        throw new Error(
          "Conversion windows (and delay) are only allowed on steps after the first",
        );
      }
    });
  }

  public toApiInterface(doc: PopulationInterface): ApiPopulation {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      owner: doc.owner || "",
      name: doc.name,
      description: doc.description || "",
      projects: doc.projects || [],
      datasource: doc.datasource,
      userIdTypes: doc.userIdTypes || [],
      steps: doc.steps.map(toApiPopulationStep),
    };
  }

  protected async processApiCreateBody(
    rawBody: unknown,
  ): Promise<CreateProps<PopulationInterface>> {
    const body = apiCreatePopulationBody.parse(rawBody);
    return {
      name: body.name,
      description: body.description ?? "",
      projects: body.projects ?? [],
      owner: body.owner ?? "",
      datasource: body.datasource,
      userIdTypes: body.userIdTypes ?? [],
      steps: body.steps.map(fromApiPopulationStep),
    };
  }

  protected async processApiUpdateBody(
    rawBody: unknown,
  ): Promise<UpdateProps<PopulationInterface>> {
    const body = apiUpdatePopulationBody.parse(rawBody);
    return {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.projects !== undefined ? { projects: body.projects } : {}),
      ...(body.owner !== undefined ? { owner: body.owner } : {}),
      ...(body.userIdTypes !== undefined
        ? { userIdTypes: body.userIdTypes }
        : {}),
      ...(body.steps !== undefined
        ? { steps: body.steps.map(fromApiPopulationStep) }
        : {}),
    };
  }
}
