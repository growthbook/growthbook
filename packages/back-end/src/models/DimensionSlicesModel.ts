import { DimensionSlicesInterface } from "shared/types/dimension";
import { dimensionSlicesValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: dimensionSlicesValidator,
  collectionName: "dimensionslices",
  idPrefix: "dimslice_",
  globallyUniquePrimaryKeys: true,
});

export class DimensionSlicesModel extends BaseClass {
  protected migrate(legacyDoc: unknown): DimensionSlicesInterface {
    const doc = legacyDoc as DimensionSlicesInterface;
    return {
      ...doc,
      dateCreated: doc.dateCreated ?? new Date(),
      dateUpdated: doc.dateUpdated ?? new Date(),
      results: doc.results ?? [],
    };
  }

  protected canRead(doc: DimensionSlicesInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects || [],
    );
  }
  protected canCreate(doc: DimensionSlicesInterface): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canRunHealthQueries({
      projects: datasource?.projects || [],
    });
  }
  protected canUpdate(existing: DimensionSlicesInterface): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: DimensionSlicesInterface): boolean {
    return this.canCreate(doc);
  }
}
