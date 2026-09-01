import type { ApiReqContext } from "back-end/types/api";

export function requireCbEditable(
  context: ApiReqContext,
  cb: { status: string; archived: boolean },
): void {
  if (cb.archived || cb.status === "stopped") {
    context.throwBadRequestError(
      `Only draft or running contextual bandits can have their visual changes edited (this contextual bandit is ${
        cb.archived ? "archived" : cb.status
      }).`,
    );
  }
}
