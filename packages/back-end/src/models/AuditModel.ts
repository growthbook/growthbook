import { AuditInterface, EntityType } from "shared/types/audit";
import { auditSchema } from "shared/validators";
import { CreateProps } from "shared/types/base-model";
import { getCollection } from "back-end/src/util/mongo.util";
import { FindOptions, MakeModelClass, ScopedFilterQuery } from "./BaseModel";

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
  protected canUpdate(): boolean {
    return true;
  }
  protected canDelete(): boolean {
    return true;
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

  public async findAuditByEntity(
    type: EntityType,
    id: string,
    options?: FindOptions<AuditInterface>,
    customFilter?: ScopedFilterQuery<typeof auditSchema>,
  ): Promise<AuditInterface[]> {
    return await this._find(
      {
        "entity.object": type,
        "entity.id": id,
        ...customFilter,
      },
      options,
    );
  }

  public async findAuditByEntityList(
    type: EntityType,
    ids: string[],
    customFilter?: ScopedFilterQuery<typeof auditSchema>,
    options?: FindOptions<AuditInterface>,
  ): Promise<AuditInterface[]> {
    return await this._find(
      {
        "entity.object": type,
        "entity.id": {
          $in: ids,
        },
        ...customFilter,
      },
      options,
    );
  }

  public async findAuditByEntityParent(
    type: EntityType,
    id: string,
    options?: FindOptions<AuditInterface>,
    customFilter?: ScopedFilterQuery<typeof auditSchema>,
  ): Promise<AuditInterface[]> {
    return await this._find(
      {
        "parent.object": type,
        "parent.id": id,
        ...customFilter,
      },
      options,
    );
  }

  public async findAllAuditsByEntityType(
    type: EntityType,
    options?: FindOptions<AuditInterface>,
    customFilter?: ScopedFilterQuery<typeof auditSchema>,
  ): Promise<AuditInterface[]> {
    return await this._find(
      {
        "entity.object": type,
        ...customFilter,
      },
      options,
    );
  }

  public async findAllAuditsByEntityTypeParent(
    type: EntityType,
    options?: FindOptions<AuditInterface>,
    customFilter?: ScopedFilterQuery<typeof auditSchema>,
  ): Promise<AuditInterface[]> {
    return await this._find(
      {
        "parent.object": type,
        ...customFilter,
      },
      options,
    );
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

  public static async dangerousInsertRawAuditForOrg(
    orgId: string,
    data: CreateProps<AuditInterface>,
  ) {
    const docToInsert = {
      ...data,
      organization: orgId,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    await getCollection(COLLECTION_NAME).insertOne(docToInsert);
  }
}
