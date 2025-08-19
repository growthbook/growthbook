import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { toSegmentApiInterface } from "back-end/src/services/segments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postSegmentValidator } from "back-end/src/validators/openapi";
import { PostSegmentResponse } from "back-end/types/openapi";

export const postSegment = createApiRequestHandler(postSegmentValidator)(async (
  req,
): Promise<PostSegmentResponse> => {
  console.log("req.body", req.body);
  const datasourceDoc = await getDataSourceById(
    req.context,
    req.body.datasource,
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }
  console.log("about to save");

  const segmentData = {
    ...req.body,
    owner: req.context.userId || "",
    description: req.body.description || "",
  };

  console.log("segmentData", segmentData);

  const segment = await req.context.models.segments.create(segmentData);

  return {
    segment: toSegmentApiInterface(segment),
  };
});
