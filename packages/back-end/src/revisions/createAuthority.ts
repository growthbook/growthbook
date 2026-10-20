import {
  constantPublishEnvironments,
  scopedOverridesFootprint,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";

/**
 * Creating an entity WITH environment-scoped live state is a publish into those
 * environments — the values serve immediately, and a `@const:`/`@config:` ref a
 * feature already embeds can resolve them into payloads the moment the key
 * exists. Create authority alone is project-scoped, so without this gate an
 * env-limited caller could reach production through the create door while the
 * identical update is refused. The feature twin is
 * `assertCanCreateFeatureInState`.
 */
export function assertCanCreateConstantInState(
  context: ReqContext | ApiReqContext,
  constant: { project?: string; environmentValues?: Record<string, unknown> },
): void {
  const envs = Object.keys(constant.environmentValues ?? {});
  if (
    envs.length &&
    !context.permissions.canRevisionAction(
      "constant",
      "publish",
      { project: constant.project },
      constantPublishEnvironments(envs),
    )
  ) {
    context.permissions.throwPermissionError();
  }
}

export function assertCanCreateConfigInState(
  context: ReqContext | ApiReqContext,
  config: {
    project?: string;
    scopedOverrides?: { environments?: string[] }[] | null;
  },
): void {
  if (!config.scopedOverrides?.length) return;
  if (
    !context.permissions.canRevisionAction(
      "config",
      "publish",
      { project: config.project },
      scopedOverridesFootprint({
        current: [],
        proposed: config.scopedOverrides,
        allEnvironments: getEnvironmentIdsFromOrg(context.org),
      }),
    )
  ) {
    context.permissions.throwPermissionError();
  }
}
