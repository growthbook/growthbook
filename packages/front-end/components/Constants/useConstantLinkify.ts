import { useMemo } from "react";
import { CONSTANT_REF_PATTERN } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { LinkifyConfig } from "@/components/SyntaxHighlighting/InlineCode";

// Linkifies `@const:key` references to the matching config/constant detail
// page; unknown/archived keys stay plain text.
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
      getHref: (key: string) => {
        if (constantKeys.has(key)) return `/constants/${key}`;
        if (configKeys.has(key)) return `/configs/${key}`;
        return undefined;
      },
    };
  }, [constants, configs]);
}
