import { AgreementType, agreementValidator } from "shared/validators";
import { MakeModelClass } from "back-end/src/models/BaseModel";

const BaseClass = MakeModelClass({
  schema: agreementValidator,
  collectionName: "agreements",
  idPrefix: "agree_",
  auditLog: {
    entity: "agreement",
    createEvent: "agreement.create",
    updateEvent: "agreement.update",
    deleteEvent: "agreement.delete",
  },
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [
    {
      fields: {
        organization: 1,
        agreement: 1,
      },
      unique: false,
    },
  ],
});

export class AgreementModel extends BaseClass {
  protected canRead(): boolean {
    // TODO: should this be something else?  Perhaps readonly users shouldn't be able to access
    // it as they shouldn't be able to call an endpoint that would need AI's help.
    return true;
  }
  protected canCreate(): boolean {
    return this.context.permissions.canManageOrgSettings();
  }
  protected canUpdate(): boolean {
    return this.canCreate();
  }
  protected canDelete(): boolean {
    return this.canCreate();
  }

  public getAgreementForOrg = async (agreement: AgreementType) => {
    const existing = await this._findOne({
      agreement: agreement,
    });
    return existing ? existing : null;
  };
}
