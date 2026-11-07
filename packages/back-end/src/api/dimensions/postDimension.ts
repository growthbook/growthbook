import uniqid from "uniqid";
import { postDimensionValidator } from "shared/validators";
import { DEFAULT_DIMENSION_TIMING } from "shared/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import {
  createDimension,
  toDimensionApiInterface,
} from "back-end/src/models/DimensionModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { validateDimensionBeforeSave } from "back-end/src/services/dimensions";

export const postDimension = createApiRequestHandler(postDimensionValidator)(
  async (req) => {
    if (!req.context.permissions.canCreateDimension()) {
      req.context.permissions.throwPermissionError();
    }

    const organization = req.organization.id;

    const datasourceDoc = await getDataSourceById(
      req.context,
      req.body.datasourceId,
    );
    if (!datasourceDoc) {
      throw new Error("Invalid data source");
    }

    await validateDimensionBeforeSave(req.context, datasourceDoc, {
      sql: req.body.query,
      userIdType: req.body.identifierType,
      timing: req.body.timing,
    });

    const dimension = await createDimension({
      datasource: req.body.datasourceId,
      userIdType: req.body.identifierType,
      owner: (await resolveOwnerToUserId(req.body.owner, req.context)) ?? "",
      name: req.body.name,
      description: req.body.description || "",
      sql: req.body.query,
      timing: req.body.timing ?? DEFAULT_DIMENSION_TIMING,
      nullLabel: req.body.nullLabel ?? "",
      id: uniqid("dim_"),
      dateCreated: new Date(),
      dateUpdated: new Date(),
      managedBy: req.body.managedBy || "",
      organization,
    });

    return {
      dimension: await resolveOwnerEmail(
        toDimensionApiInterface(dimension),
        req.context,
      ),
    };
  },
);
