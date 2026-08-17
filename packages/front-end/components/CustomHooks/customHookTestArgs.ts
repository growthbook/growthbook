import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { getEffectiveRevisionTags } from "shared/util";
import { CustomHookType } from "shared/validators";

// Builds the functionArgs sent to POST /custom-hooks/test from the Test
// panel's editable JSON textareas.
//
// The server always derives `revision.tags` fresh from `revision.metadata`
// (see getEffectiveRevisionTags) — it never trusts a submitted `tags` field.
// Recompute it here too, at submit time, so an edit to `metadata.tags` in the
// textarea can't leave a stale sibling `tags` value that disagrees with what
// the hook would actually see on a real save.
export function buildHookTestFunctionArgs(
  testValues: Record<string, string>,
  hookType: CustomHookType,
  feature: Pick<FeatureInterface, "tags"> | undefined,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(testValues).map(([key, rawValue]) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawValue);
      } catch {
        return [key, rawValue];
      }

      if (
        key === "revision" &&
        hookType === "validateFeatureRevision" &&
        parsed !== null &&
        typeof parsed === "object"
      ) {
        return [
          key,
          {
            ...parsed,
            tags: getEffectiveRevisionTags(
              feature ?? {},
              parsed as Pick<FeatureRevisionInterface, "metadata">,
            ),
          },
        ];
      }

      return [key, parsed];
    }),
  );
}
