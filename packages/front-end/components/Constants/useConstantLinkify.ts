import { useMemo } from "react";
import { ANY_REF_PATTERN } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { LinkifyConfig } from "@/components/SyntaxHighlighting/InlineCode";

// Linkifies `@const:key` / `@config:key` references to the matching detail page.
// The two namespaces are independent (a key may exist in both), so route by the
// reference's own `@const:`/`@config:` prefix. Unknown/archived keys stay plain
// text.
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
      // Capture the full token so getHref can read the namespace prefix.
      pattern: new RegExp("(" + ANY_REF_PATTERN + ")"),
      getHref: (token: string) => {
        const m = token.match(/^@(const|config):(.+)$/);
        if (!m) return undefined;
        const [, ns, key] = m;
        if (ns === "config") {
          return configKeys.has(key) ? `/configs/${key}` : undefined;
        }
        return constantKeys.has(key) ? `/constants/${key}` : undefined;
      },
    };
  }, [constants, configs]);
}
