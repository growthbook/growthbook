import {
  PopulationAnalysisInterface,
  populationAnalysisValidator,
} from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: populationAnalysisValidator,
  collectionName: "populationanalyses",
  idPrefix: "popan_",
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        population: 1,
        dateCreated: -1,
      },
    },
  ],
});

// Callers check the Population itself first; these checks follow its data
// source, like the other query-result models.
export class PopulationAnalysisModel extends BaseClass {
  protected canRead(doc: PopulationAnalysisInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects || [],
    );
  }
  protected canCreate(doc: PopulationAnalysisInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canRunFactQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(existing: PopulationAnalysisInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: PopulationAnalysisInterface): boolean {
    return this.canCreate(doc);
  }

  public async findLatestByPopulation(
    population: string,
  ): Promise<PopulationAnalysisInterface | null> {
    const [latest] = await this._find(
      { population },
      { sort: { dateCreated: -1 }, limit: 1 },
    );
    return latest ?? null;
  }
}
