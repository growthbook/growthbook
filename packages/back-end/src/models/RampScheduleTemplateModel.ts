import { UpdateProps } from "shared/types/base-model";
import {
  RampScheduleTemplateInterface,
  rampScheduleTemplateValidator,
} from "shared/validators";
import { rampScheduleTemplateApiSpec } from "back-end/src/api/specs/ramp-schedule-template.spec";
import { MakeModelClass } from "./BaseModel";
import { migrateRampStepTriggers } from "./RampScheduleModel";

const BaseClass = MakeModelClass({
  schema: rampScheduleTemplateValidator,
  collectionName: "rampscheduletemplates",
  idPrefix: "rst_",
  auditLog: {
    entity: "rampScheduleTemplate",
    createEvent: "rampScheduleTemplate.create",
    updateEvent: "rampScheduleTemplate.update",
    deleteEvent: "rampScheduleTemplate.delete",
  },
  globallyUniquePrimaryKeys: false,
  apiConfig: {
    modelKey: "rampScheduleTemplates",
    openApiSpec: rampScheduleTemplateApiSpec,
  },
});

export class RampScheduleTemplateModel extends BaseClass {
  protected migrate(legacyDoc: unknown): RampScheduleTemplateInterface {
    const doc = legacyDoc as RampScheduleTemplateInterface;
    return migrateRampStepTriggers(
      doc as unknown as Parameters<typeof migrateRampStepTriggers>[0],
    ) as unknown as RampScheduleTemplateInterface;
  }

  protected canRead() {
    return this.context.permissions.canViewFeatureModal(undefined);
  }
  protected canCreate() {
    return this.context.permissions.canCreateFeature({ project: undefined });
  }
  protected canUpdate(
    _existing: RampScheduleTemplateInterface,
    _updates: UpdateProps<RampScheduleTemplateInterface>,
  ) {
    return this.context.permissions.canUpdateFeature(
      { project: undefined },
      { project: undefined },
    );
  }
  protected canDelete(_existing: RampScheduleTemplateInterface) {
    return this.context.permissions.canDeleteFeature({ project: undefined });
  }
}
