import {
  createDataSource,
  fromPostDataSourcePayload,
  toDataSourceApiInterface,
} from "back-end/src/models/DataSourceModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postDataSourceValidator } from "back-end/src/validators/openapi";
import { PostDataSourceResponse } from "back-end/types/openapi";

export const postDataSource = createApiRequestHandler(postDataSourceValidator)(
  async (req): Promise<PostDataSourceResponse> => {
    const { name, type, description, params, settings, projects } =
      fromPostDataSourcePayload(req.body);
    if (
      !req.context.permissions.canCreateDataSource({
        projects,
        type,
      })
    ) {
      req.context.permissions.throwPermissionError();
    }

    const datasource = await createDataSource(
      req.context,
      name,
      type,
      params,
      settings,
      undefined, // id will be auto-generated
      description,
      projects
    );

    await req.audit({
      event: "datasource.create",
      entity: {
        object: "datasource",
        id: datasource.id,
      },
      details: auditDetailsCreate(datasource),
    });

    return {
      dataSource: toDataSourceApiInterface(datasource),
    };
  }
);
