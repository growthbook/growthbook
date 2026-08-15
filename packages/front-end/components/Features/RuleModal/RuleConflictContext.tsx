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
  format: (chunk: ContestedChunk, side: ConflictResolution) => string;
  // Chunks a field is rendering inline; registered during layout so the
  // modal's fallback settles before paint.
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

export function useContestedChunk(field: string): ContestedChunk | undefined {
  const ctx = useRuleConflict();
  return ctx?.contested.find((c) => c.fields.includes(field));
}

// A toggle pair, not a one-way door: either choice can be switched afterwards.
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

// One row for both placements: icon, message, and the choice buttons, all
// vertically centered until the row wraps. Rendered as children rather than
// via Callout's icon/action slots, which pin themselves to a single text line
// and so sit off-center against taller buttons.
export function ConflictCalloutRow({
  chunk,
  showMine = false,
}: {
  chunk: ContestedChunk;
  showMine?: boolean;
}) {
  return (
    <Callout status="warning" size="sm" icon={null} mb="3">
      <Flex align="center" justify="between" gap="3" wrap="wrap" width="100%">
        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
          <PiGitMerge size={13} style={{ flexShrink: 0 }} />
          <ConflictMessage chunk={chunk} showMine={showMine} />
        </Flex>
        <ConflictButtons chunk={chunk} />
      </Flex>
    </Callout>
  );
}

// Drop under a form control to render that field's conflict in place. Inert
// when the field isn't contested; unclaimed chunks fall back to the callouts
// the modal renders above the form.
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
  return <ConflictCalloutRow chunk={chunk} />;
}
