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
  // Chunks a field renders inline; the rest fall back to the modal's callouts.
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

// Not Callout's icon/action slots: they pin to one text line, off-center
// against taller buttons.
export function ConflictCalloutRow({
  chunk,
  showMine = false,
  stateful = false,
}: {
  chunk: ContestedChunk;
  showMine?: boolean;
  // Keeps the row after a choice; inline rows apply the value and disappear.
  stateful?: boolean;
}) {
  const ctx = useRuleConflict();
  const resolved = !!ctx?.resolutions.get(chunk.key);
  if (resolved && !stateful) return null;
  return (
    <Callout
      status="warning"
      size="sm"
      icon={null}
      mb="3"
      transparent={resolved}
    >
      <Flex align="center" gap="3" width="100%">
        <Flex align="center" gap="2" style={{ minWidth: 0, flex: "1 1 auto" }}>
          <PiGitMerge size={13} style={{ flexShrink: 0 }} />
          <ConflictMessage chunk={chunk} showMine={showMine} />
        </Flex>
        <Flex style={{ flexShrink: 0 }}>
          <ConflictButtons chunk={chunk} />
        </Flex>
      </Flex>
    </Callout>
  );
}

// Drop under a form control to render that field's conflict in place.
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
