import { postExperimentCommentValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { addComment } from "back-end/src/services/discussions";

export const postExperimentComment = createApiRequestHandler(
  postExperimentCommentValidator,
)(async (req) => {
  const context = req.context as ReqContext;
  const person = context.actingPerson;

  if (!person?.email) {
    throw new Error(
      "Commenting needs a member: use a personal access token, or an organization API key that assumes a named member's role.",
    );
  }

  const existing = await getExperimentById(context, req.params.id);
  if (!existing) {
    return context.throwNotFoundError("Could not find experiment with that id");
  }

  const projects = existing.project ? [existing.project] : [];
  if (!context.permissions.canAddComment(projects)) {
    context.permissions.throwPermissionError();
  }

  await addComment(
    context.org.id,
    "experiment",
    req.params.id,
    { id: person.id, email: person.email, name: person.name || person.email },
    req.body.comment,
  );

  return { status: 200 };
});
