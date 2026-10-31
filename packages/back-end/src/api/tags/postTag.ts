import type { TagInterface } from "shared/types/tag";
import { PostTagBody, postTagValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { addTag, getAllTags } from "back-end/src/models/TagModel";

// A field left out is empty on a new tag and keeps its value on an existing
// one. The existing values come from the list, so an existing tag with no
// stored color gets the list's default color.
export function resolveTagWrite(
  body: PostTagBody,
  existing: TagInterface | undefined,
): TagInterface {
  return {
    id: body.id,
    color: body.color ?? existing?.color ?? "",
    description: body.description ?? existing?.description ?? "",
  };
}

export const postTag = createApiRequestHandler(postTagValidator)(async (
  req,
) => {
  // Same check as the app's POST /tag: the organization-wide role only.
  if (!req.context.permissions.canCreateAndUpdateTag()) {
    req.context.permissions.throwPermissionError();
  }

  const orgId = req.context.org.id;
  const existing = (await getAllTags(orgId)).find((t) => t.id === req.body.id);
  const tag = resolveTagWrite(req.body, existing);

  await addTag(orgId, tag.id, tag.color, tag.description);

  return { tag };
});
