import { useMemo } from "react";
import { ANY_REF_PATTERN } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { LinkifyConfig } from "@/components/SyntaxHighlighting/InlineCode";

// Linkifies `@const:key` / `@config:key` references to the matching detail page;
// keys are globally unique across both namespaces, so route by membership.
// Unknown/archived keys stay plain text.
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
      pattern: new RegExp(ANY_REF_PATTERN),
      getHref: (key: string) => {
        if (constantKeys.has(key)) return `/constants/${key}`;
        if (configKeys.has(key)) return `/configs/${key}`;
        return undefined;
      },
    };
  }, [constants, configs]);
}
