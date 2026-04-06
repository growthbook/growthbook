import { PresentationThemeInterface } from "shared/types/presentation";
import { presentationThemeValidator } from "shared/validators";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: presentationThemeValidator,
  collectionName: "presentationthemes",
  idPrefix: "pt_",
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [{ fields: { organization: 1, dateUpdated: -1 } }],
  defaultValues: {
    customTheme: {
      backgroundColor: "#3400a3",
      textColor: "#ffffff",
      headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    },
  },
});

export class PresentationThemeModel extends BaseClass {
  protected hasPremiumFeature(): boolean {
    return this.context.hasPremiumFeature("adv-presentations");
  }

  protected canRead(doc: PresentationThemeInterface): boolean {
    return doc.organization === this.context.org.id;
  }

  protected canCreate(): boolean {
    return this.context.permissions.canCreatePresentation();
  }

  protected canUpdate(): boolean {
    return this.context.permissions.canUpdatePresentation();
  }

  protected canDelete(): boolean {
    return this.context.permissions.canDeletePresentation();
  }

  async getAllSortedByUpdated(): Promise<PresentationThemeInterface[]> {
    return this._find({}, { sort: { dateUpdated: -1 } });
  }
}
