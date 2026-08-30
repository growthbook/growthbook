import { PopulationDataInterface } from "shared/types/population-data";
import { populationDataInterfaceValidator } from "shared/validators";
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
  globallyUniquePrimaryKeys: false,
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
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects || [],
    );
  }
  protected canCreate(doc: PopulationDataInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canRunPopulationDataQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(existing: PopulationDataInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: PopulationDataInterface): boolean {
    return this.canCreate(doc);
  }

  public async getRecentUsingSettings(
    sourceId: string,
    userIdType: string,
    onlySuccess = true,
    lookbackDays = 7,
  ) {
    // end date in the last week
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - lookbackDays);

    const populationData = await this._find(
      {
        sourceId,
        userIdType,
        endDate: { $gte: lastWeek },
        ...(onlySuccess ? { status: "success" } : {}),
      },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return populationData[0] ? populationData[0] : null;
  }
}
