import { createApiRequestHandler } from "../../util/handler";

export const getUser = createApiRequestHandler()(
  async (req): Promise<any> => {
    // console.log("req", req);
    console.log("looking up user by id");
    // const dataSource = await getDataSourceById(
    //   req.params.id,
    //   req.organization.id
    // );
    // if (!dataSource) {
    //   throw new Error("Could not find dataSource with that id");
    // }

    // return {
    //   dataSource: toDataSourceApiInterface(dataSource),
    // };
    // return { user: "acb123" };
  }
);
