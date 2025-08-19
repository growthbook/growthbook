import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { toSegmentApiInterface } from "back-end/src/services/segments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postSegmentValidator } from "back-end/src/validators/openapi";
import { PostSegmentResponse } from "back-end/types/openapi";

export const postSegment = createApiRequestHandler(postSegmentValidator)(async (
  req,
): Promise<PostSegmentResponse> => {
  const datasourceDoc = await getDataSourceById(
    req.context,
    req.body.datasource,
  );
  if (!datasourceDoc) {
    throw new Error("Invalid data source");
  }

  const segmentData = {
    ...req.body,
    owner: req.context.userId || "",
    description: req.body.description || "",
  };

  const segment = await req.context.models.segments.create(segmentData);

  return {
    segment: toSegmentApiInterface(segment),
  };
});
