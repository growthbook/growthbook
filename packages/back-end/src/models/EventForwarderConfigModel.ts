import {
  EventForwarderConfigInterface,
  eventForwarderConfigValidator,
} from "shared/validators";
import { UpdateProps } from "shared/types/base-model";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: eventForwarderConfigValidator,
  collectionName: "eventForwarderConfigs",
  idPrefix: "efc_",
  additionalIndexes: [
    {
      fields: { organization: 1, sinkType: 1 },
      unique: true,
    },
  ],
  auditLog: {
    entity: "eventForwarderConfig",
    createEvent: "eventForwarderConfig.create",
    updateEvent: "eventForwarderConfig.update",
    deleteEvent: "eventForwarderConfig.delete",
  },
  globallyUniquePrimaryKeys: true,
});

export class EventForwarderConfigModel extends BaseClass {
  protected canCreate(doc: EventForwarderConfigInterface): boolean {
    return this.context.permissions.canCreateEventForwarderConfig(doc);
  }

  protected canRead(doc: EventForwarderConfigInterface): boolean {
    return this.context.permissions.canReadMultiProjectResource(doc.projects);
  }

  protected canUpdate(
    existing: EventForwarderConfigInterface,
    _updates: UpdateProps<EventForwarderConfigInterface>,
    newDoc: EventForwarderConfigInterface,
  ): boolean {
    return this.context.permissions.canUpdateEventForwarderConfig(
      existing,
      newDoc,
    );
  }

  protected canDelete(doc: EventForwarderConfigInterface): boolean {
    return this.context.permissions.canDeleteEventForwarderConfig(doc);
  }
}
