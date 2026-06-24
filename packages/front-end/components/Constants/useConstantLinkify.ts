import { useMemo } from "react";
import { CONSTANT_REF_PATTERN } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { LinkifyConfig } from "@/components/SyntaxHighlighting/InlineCode";

// Builds a LinkifyConfig that turns `@const:key` references in a displayed
// value into links to the referenced constant's detail page. Only keys that
// resolve to a known (non-archived) constant become links; unknown keys are
// left as plain text. Pass the result to ValueDisplay's `linkify` prop.
export function useConstantLinkify(): LinkifyConfig {
  const { constants } = useDefinitions();

  return useMemo(() => {
    const liveKeys = new Set(
      constants.filter((c) => !c.archived).map((c) => c.key),
    );
    return {
      pattern: new RegExp(CONSTANT_REF_PATTERN),
      // The detail page is addressed by key; only link keys that resolve to a
      // known (non-archived) constant.
      getHref: (key: string) =>
        liveKeys.has(key) ? `/constants/${key}` : undefined,
    };
  }, [constants]);
}
