import { useMemo } from "react";
import { CONSTANT_REF_PATTERN } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { LinkifyConfig } from "@/components/SyntaxHighlighting/InlineCode";

// Builds a LinkifyConfig that turns `@const:key` references in a displayed
// value into links to the referenced entity's detail page. Both constants and
// configs share the `@const:` namespace, so a key may resolve to either — link
// it to the matching page (`/constants/:key` or `/configs/:key`). Only keys
// that resolve to a known (non-archived) entity become links; unknown keys are
// left as plain text. Pass the result to ValueDisplay's `linkify` prop.
export function useConstantLinkify(): LinkifyConfig {
  const { constants, configs } = useDefinitions();

  return useMemo(() => {
    const constantKeys = new Set(
      constants.filter((c) => !c.archived).map((c) => c.key),
    );
    const configKeys = new Set(
      configs.filter((c) => !c.archived).map((c) => c.key),
    );
    return {
      pattern: new RegExp(CONSTANT_REF_PATTERN),
      // The detail page is addressed by key; only link keys that resolve to a
      // known (non-archived) constant or config.
      getHref: (key: string) => {
        if (constantKeys.has(key)) return `/constants/${key}`;
        if (configKeys.has(key)) return `/configs/${key}`;
        return undefined;
      },
    };
  }, [constants, configs]);
}
