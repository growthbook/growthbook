import {
  createContext,
  ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";
import { Flex } from "@radix-ui/themes";
import { PiGitMerge } from "react-icons/pi";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

export type ContestedChunk = { key: string; fields: string[] };
export type ConflictResolution = "mine" | "theirs";

type RuleConflictContextValue = {
  contested: ContestedChunk[];
  resolutions: Map<string, ConflictResolution>;
  resolve: (chunk: ContestedChunk, choice: ConflictResolution) => void;
  /** Formats a chunk's value on either side, for display. */
  format: (chunk: ContestedChunk, side: ConflictResolution) => string;
  /**
   * Chunk keys currently rendered inline by a field. Fields register during
   * layout (see RuleConflictCallout) so the modal's fallback settles before
   * paint rather than flashing a duplicate callout.
   */
  claimed: Set<string>;
  claim: (key: string) => void;
  release: (key: string) => void;
};

const RuleConflictContext = createContext<RuleConflictContextValue | null>(
  null,
);

export function RuleConflictProvider({
  contested,
  resolutions,
  resolve,
  format,
  claimed,
  claim,
  release,
  children,
}: RuleConflictContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      contested,
      resolutions,
      resolve,
      format,
      claimed,
      claim,
      release,
    }),
    [contested, resolutions, resolve, format, claimed, claim, release],
  );

  return (
    <RuleConflictContext.Provider value={value}>
      {children}
    </RuleConflictContext.Provider>
  );
}

export function useRuleConflict() {
  return useContext(RuleConflictContext);
}

/** The contested chunk covering `field`, or undefined when it isn't contested. */
export function useContestedChunk(field: string): ContestedChunk | undefined {
  const ctx = useRuleConflict();
  return ctx?.contested.find((c) => c.fields.includes(field));
}

export function ConflictChoice({
  chunk,
  // Inline under its own field, the field name and your own value are both
  // already on screen — so only their value needs stating.
  inline = false,
}: {
  chunk: ContestedChunk;
  inline?: boolean;
}) {
  const ctx = useRuleConflict();
  if (!ctx) return null;
  const resolution = ctx.resolutions.get(chunk.key);
  return (
    <Flex align="center" gap="2" wrap="wrap">
      {!inline && (
        <>
          <Text weight="semibold">
            {chunk.fields.length > 1 ? chunk.fields.join(" + ") : chunk.key}
          </Text>
          <Text>— you set</Text>
          <code
            style={{
              background: "var(--color-surface)",
              borderRadius: "var(--radius-1)",
              padding: "1px 6px",
            }}
          >
            {ctx.format(chunk, "mine")}
          </code>
          <Text>,</Text>
        </>
      )}
      <Text>they set</Text>
      <code
        style={{
          background: "var(--color-surface)",
          borderRadius: "var(--radius-1)",
          padding: "1px 6px",
        }}
      >
        {ctx.format(chunk, "theirs")}
      </code>
      {resolution ? (
        <Text weight="semibold">
          ✓ {resolution === "mine" ? "keeping yours" : "using theirs"}
        </Text>
      ) : (
        <>
          <Button size="sm" onClick={() => ctx.resolve(chunk, "mine")}>
            Keep mine
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => ctx.resolve(chunk, "theirs")}
          >
            Use theirs
          </Button>
        </>
      )}
    </Flex>
  );
}

/**
 * Drop under a form control to render that field's conflict inline. Renders
 * nothing when there's no conflict for the field, so it's safe to leave in
 * place permanently. Fields without one of these fall back to the callouts
 * the modal renders above the form — see `claimed` in the provider.
 */
export default function RuleConflictCallout({ field }: { field: string }) {
  const ctx = useRuleConflict();
  const chunk = useContestedChunk(field);
  const key = chunk?.key;
  const claim = ctx?.claim;
  const release = ctx?.release;

  useLayoutEffect(() => {
    if (!key || !claim || !release) return;
    claim(key);
    return () => release(key);
  }, [key, claim, release]);

  if (!ctx || !chunk) return null;
  return (
    <HelperText status="error" mt="2" mb="3" icon={<PiGitMerge size={15} />}>
      <ConflictChoice chunk={chunk} inline />
    </HelperText>
  );
}
