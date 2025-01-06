import { PopulationDataInterface } from "back-end/types/population-data";
import { populationDataInterfaceValidator } from "back-end/src/routers/population-data/population-data.validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: populationDataInterfaceValidator,
  collectionName: "populationdata",
  idPrefix: "popdat_",
  auditLog: {
    entity: "populationData",
    createEvent: "populationData.create",
    updateEvent: "populationData.update",
    deleteEvent: "populationData.delete",
  },
  globallyUniqueIds: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        dateCreated: -1,
      },
    },
  ],
});

export class PopulationDataModel extends BaseClass {
  protected canRead(doc: PopulationDataInterface): boolean {
    // Do I need to prevent reading for any metric used
    // in data
    const { metric } = this.getForeignRefs(doc);
    return this.context.permissions.canReadMultiProjectResource(
      metric?.projects || []
    );
  }
  protected canCreate(doc: PopulationDataInterface): boolean {
    // TODO
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canCreateMetricAnalysis({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(existing: PopulationDataInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: PopulationDataInterface): boolean {
    return this.canCreate(doc);
  }
}
