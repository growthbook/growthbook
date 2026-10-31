import { listTagsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getAllTags } from "back-end/src/models/TagModel";

// No permission check: every member already gets this list with the
// organization's definitions.
export const listTags = createApiRequestHandler(listTagsValidator)(async (
  req,
) => {
  const tags = await getAllTags(req.context.org.id);
  return { tags };
});
