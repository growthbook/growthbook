import { postExperimentCommentValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { addComment } from "back-end/src/services/discussions";

export const postExperimentComment = createApiRequestHandler(
  postExperimentCommentValidator,
)(async (req) => {
  const context = req.context as ReqContext;
  const { org, userId, email, userName } = context;

  const existing = await getExperimentById(context, req.params.id);
  if (!existing) {
    throw new Error("Could not find experiment with that id");
  }

  const projects = existing.project ? [existing.project] : [];
  if (!context.permissions.canAddComment(projects)) {
    context.permissions.throwPermissionError();
  }

  await addComment(
    org.id,
    "experiment",
    req.params.id,
    { id: userId, email, name: userName },
    req.body.comment,
  );

  return { status: 200 };
});
