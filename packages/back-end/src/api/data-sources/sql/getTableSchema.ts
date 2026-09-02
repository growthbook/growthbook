import { getTableSchemaValidator } from "shared/validators";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getWarehouseTableSchema } from "back-end/src/agent/ask-data-tools";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getTableSchema = createApiRequestHandler(getTableSchemaValidator)(
  async (req) => {
    const datasource = await getDataSourceById(req.context, req.params.id);
    if (!datasource) {
      throw new Error("Could not find data source with that id");
    }
    if (!req.context.org.settings?.aiAskDataEnabled) {
      throw new Error("Ask data is not enabled for this organization");
    }
    if (!datasource.settings?.askData?.enabled) {
      throw new Error("Ask data is not enabled for this data source");
    }
    if (!req.context.permissions.canRunSchemaQueries(datasource)) {
      req.context.permissions.throwPermissionError();
    }

    const result = await getWarehouseTableSchema(
      req.context,
      datasource,
      req.body,
    );
    return result as {
      tables: Array<{
        database: string;
        schema: string;
        table: string;
        columns: Array<{
          name: string;
          type: string;
          description?: string;
        }>;
      }>;
    };
  },
);
