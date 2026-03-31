import { GetInformationSchemaResponse } from "shared/types/openapi";
import { getInformationSchemaValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getInformationSchemaByDatasourceId } from "back-end/src/models/InformationSchemaModel";
import { getInformationSchemaWithPaths } from "back-end/src/services/informationSchema";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getInformationSchema = createApiRequestHandler(
  getInformationSchemaValidator,
)(async (req): Promise<GetInformationSchemaResponse> => {
  const dataSource = await getDataSourceById(
    req.context,
    req.params.dataSourceId,
  );
  if (!dataSource) {
    throw new Error("Could not find data source with that id");
  }

  const informationSchema = await getInformationSchemaByDatasourceId(
    dataSource.id,
    req.context.org.id,
  );

  return {
    informationSchema: informationSchema
      ? getInformationSchemaWithPaths(informationSchema, dataSource.type)
      : null,
  };
});
