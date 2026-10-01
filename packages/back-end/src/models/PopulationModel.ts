import { PopulationInterface } from "shared/types/population";
import { populationValidator } from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
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
}
