import { AuditInterface, EventTypes, EntityType } from "shared/types/audit";
import { auditSchema } from "shared/validators";
import { MakeModelClass, ScopedFilterQuery } from "./BaseModel";

const COLLECTION_NAME = "audits";
const BaseClass = MakeModelClass({
  schema: auditSchema,
  collectionName: COLLECTION_NAME,
  idPrefix: "aud_",
  globallyUniqueIds: false,
  readonlyFields: [],
  additionalIndexes: [
    {
      fields: { "user.id": 1, organization: 1 },
    },
    { fields: { organization: 1, "entity.object": 1, "entity.id": 1 } },
    { fields: { organization: 1, "parent.object": 1, "parent.id": 1 } },
  ],
});

export class AuditModel extends BaseClass {
  protected canCreate(): boolean {
    return true;
  }
  protected canRead(): boolean {
    return true;
  }
  // Audits should be append-only
  protected canUpdate(): boolean {
    return false;
  }
  protected canDelete(): boolean {
    return false;
  }

  public async findRecentAuditByUserId(userId: string) {
    return await this._find(
      {
        "user.id": userId,
      },
      {
        limit: 10,
        projection: {
          details: 0,
        },
        sort: { dateCreated: -1 },
      },
    );
  }

  public async findAuditByEntity({
    type,
    id,
    limit,
    maxDateCreated,
  }: {
    type: EntityType;
    id: string;
    limit?: number;
    maxDateCreated?: Date;
  }): Promise<AuditInterface[]> {
    const filter: ScopedFilterQuery<typeof auditSchema> = {
      "entity.object": type,
      "entity.id": id,
    };
    if (maxDateCreated) {
      filter.dateCreated = { $lt: maxDateCreated };
    }
    return await this._find(filter, { limit, sort: { dateCreated: -1 } });
  }

  public async findAuditByEntityList<E extends EntityType = EntityType>({
    type,
    ids,
    minDateCreated,
    eventList,
  }: {
    type: E;
    ids: string[];
    minDateCreated?: Date;
    eventList?: EventTypes<E>[];
  }): Promise<AuditInterface[]> {
    const filter: ScopedFilterQuery<typeof auditSchema> = {
      "entity.object": type,
      "entity.id": {
        $in: ids,
      },
    };
    if (minDateCreated) {
      filter.dateCreated = { $gte: minDateCreated };
    }
    if (eventList) {
      filter.event = { $in: eventList };
    }
    return await this._find(filter);
  }

  public async findAuditByEntityParent({
    type,
    id,
    limit,
    maxDateCreated,
  }: {
    type: EntityType;
    id: string;
    limit?: number;
    maxDateCreated?: Date;
  }): Promise<AuditInterface[]> {
    const filter: ScopedFilterQuery<typeof auditSchema> = {
      "parent.object": type,
      "parent.id": id,
    };
    if (maxDateCreated) {
      filter.dateCreated = { $lt: maxDateCreated };
    }
    return await this._find(filter, { limit, sort: { dateCreated: -1 } });
  }

  public async findAllAuditsByEntityType({
    type,
    limit,
    maxDateCreated,
  }: {
    type: EntityType;
    limit?: number;
    maxDateCreated?: Date;
  }): Promise<AuditInterface[]> {
    const filter: ScopedFilterQuery<typeof auditSchema> = {
      "entity.object": type,
    };
    if (maxDateCreated) {
      filter.dateCreated = { $lt: maxDateCreated };
    }
    return await this._find(filter, { limit, sort: { dateCreated: -1 } });
  }

  public async findAllAuditsByEntityTypeParent({
    type,
    limit,
    maxDateCreated,
  }: {
    type: EntityType;
    limit?: number;
    maxDateCreated?: Date;
  }): Promise<AuditInterface[]> {
    const filter: ScopedFilterQuery<typeof auditSchema> = {
      "parent.object": type,
    };
    if (maxDateCreated) {
      filter.dateCreated = { $lt: maxDateCreated };
    }
    return await this._find(filter, { limit, sort: { dateCreated: -1 } });
  }

  public async countAuditByEntity(
    type: EntityType,
    id: string,
  ): Promise<number> {
    return await this._countDocuments({
      "entity.object": type,
      "entity.id": id,
    });
  }

  public async countAuditByEntityParent(
    type: EntityType,
    id: string,
  ): Promise<number> {
    return await this._countDocuments({
      "parent.object": type,
      "parent.id": id,
    });
  }

  public async countAllAuditsByEntityType(type: EntityType): Promise<number> {
    return await this._countDocuments({
      "entity.object": type,
    });
  }

  public async countAllAuditsByEntityTypeParent(
    type: EntityType,
  ): Promise<number> {
    return await this._countDocuments({
      "parent.object": type,
    });
  }
}
