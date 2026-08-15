import {
  createContext,
  ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";
import { Flex } from "@radix-ui/themes";
import { PiCheck, PiGitMerge } from "react-icons/pi";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export type ContestedChunk = { key: string; fields: string[] };
export type ConflictResolution = "mine" | "theirs";

// Values are shown in full, so long ones (JSON blobs, conditions) have to wrap
// rather than overflow the callout.
const CONFLICT_VALUE_STYLE = {
  background: "var(--color-surface)",
  borderRadius: "var(--radius-1)",
  padding: "1px 6px",
  whiteSpace: "pre-wrap" as const,
  overflowWrap: "anywhere" as const,
  minWidth: 0,
};

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

/**
 * Both choices stay on screen as a toggle pair — the active one is filled and
 * check-marked — so a resolution can be changed rather than being a one-way
 * door. Switching back to "mine" restores the value the field held when the
 * conflict surfaced (see `resolve` in RuleModal).
 */
function ConflictButtons({ chunk }: { chunk: ContestedChunk }) {
  const ctx = useRuleConflict();
  if (!ctx) return null;
  const resolution = ctx.resolutions.get(chunk.key);
  const choice = (side: ConflictResolution, label: string) => {
    const active = resolution === side;
    return (
      <Button
        size="sm"
        variant={active ? "solid" : "outline"}
        icon={active ? <PiCheck /> : undefined}
        onClick={() => ctx.resolve(chunk, side)}
      >
        {label}
      </Button>
    );
  };
  return (
    <Flex gap="2" align="center">
      {choice("mine", "Keep mine")}
      {choice("theirs", "Use theirs")}
    </Flex>
  );
}

/**
 * The conflict sentence, in one format everywhere: the field name, what it was
 * changed to, and — where the surrounding context doesn't already show it —
 * what you set.
 */
export function ConflictMessage({
  chunk,
  showMine = false,
}: {
  chunk: ContestedChunk;
  showMine?: boolean;
}) {
  const ctx = useRuleConflict();
  if (!ctx) return null;
  return (
    <Text>
      <Text weight="semibold">{chunk.key}</Text> was modified to{" "}
      <code style={CONFLICT_VALUE_STYLE}>{ctx.format(chunk, "theirs")}</code>.
      {showMine ? (
        <>
          {" "}
          You set{" "}
          <code style={CONFLICT_VALUE_STYLE}>{ctx.format(chunk, "mine")}</code>.
        </>
      ) : null}
    </Text>
  );
}

/**
 * The fallback presentation, rendered above the form for chunks no field
 * claimed — nothing around it shows your own value, so it states both.
 */
export function ConflictChoice({ chunk }: { chunk: ContestedChunk }) {
  return (
    <Flex align="center" gap="3" wrap="wrap">
      <ConflictMessage chunk={chunk} showMine />
      <ConflictButtons chunk={chunk} />
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
  // Your own value is already in the field beside this, so the inline copy
  // omits it. The buttons ride the Callout's action slot, which right-aligns
  // them on the first line.
  return (
    <Callout
      status="warning"
      size="sm"
      icon={<PiGitMerge size={13} />}
      action={<ConflictButtons chunk={chunk} />}
    >
      <ConflictMessage chunk={chunk} />
    </Callout>
  );
}
