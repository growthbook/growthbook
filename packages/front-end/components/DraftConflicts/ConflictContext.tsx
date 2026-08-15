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
import { CONFLICT_VALUE_STYLE } from "@/components/DraftConflicts/conflictStyles";

export type ContestedChunk = { key: string; fields: string[] };
export type ConflictResolution = "mine" | "theirs";

type ConflictContextValue = {
  contested: ContestedChunk[];
  resolutions: Map<string, ConflictResolution>;
  resolve: (chunk: ContestedChunk, choice: ConflictResolution) => void;
  format: (chunk: ContestedChunk, side: ConflictResolution) => string;
  // Chunks a field renders inline; the rest fall back to the modal's callouts.
  claimed: Set<string>;
  claim: (key: string) => void;
  release: (key: string) => void;
};

const ConflictContext = createContext<ConflictContextValue | null>(null);

export function ConflictProvider({
  contested,
  resolutions,
  resolve,
  format,
  claimed,
  claim,
  release,
  children,
}: ConflictContextValue & { children: ReactNode }) {
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
    <ConflictContext.Provider value={value}>
      {children}
    </ConflictContext.Provider>
  );
}

export function useConflict() {
  return useContext(ConflictContext);
}

export function useContestedChunk(field: string): ContestedChunk | undefined {
  const ctx = useConflict();
  return ctx?.contested.find((c) => c.fields.includes(field));
}

function ConflictButtons({ chunk }: { chunk: ContestedChunk }) {
  const ctx = useConflict();
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
  const ctx = useConflict();
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
function ConflictShell({
  resolved,
  message,
  choices,
}: {
  resolved: boolean;
  message: ReactNode;
  choices: ReactNode;
}) {
  return (
    <Callout
      status="warning"
      size="sm"
      icon={null}
      mb="3"
      style={resolved ? { backgroundColor: "transparent" } : undefined}
    >
      <Flex align="center" gap="3" width="100%">
        <Flex align="center" gap="2" style={{ minWidth: 0, flex: "1 1 auto" }}>
          <PiGitMerge size={13} style={{ flexShrink: 0 }} />
          {message}
        </Flex>
        <Flex style={{ flexShrink: 0 }}>{choices}</Flex>
      </Flex>
    </Callout>
  );
}

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
  const ctx = useConflict();
  const resolved = !!ctx?.resolutions.get(chunk.key);
  if (resolved && !stateful) return null;
  return (
    <ConflictShell
      resolved={resolved}
      message={<ConflictMessage chunk={chunk} showMine={showMine} />}
      choices={<ConflictButtons chunk={chunk} />}
    />
  );
}

/**
 * For conflicts with no fields to resolve — the entity was restructured or
 * deleted — where keeping your version is the only move.
 */
export function WholeConflictCallout({
  chunkKey,
  message,
}: {
  chunkKey: string;
  message: ReactNode;
}) {
  const ctx = useConflict();
  if (!ctx) return null;
  const chunk = { key: chunkKey, fields: [] };
  const resolved = !!ctx.resolutions.get(chunkKey);
  return (
    <ConflictShell
      resolved={resolved}
      message={<Text>{message}</Text>}
      choices={
        <Button
          size="sm"
          variant={resolved ? "solid" : "outline"}
          icon={resolved ? <PiCheck /> : undefined}
          onClick={() => ctx.resolve(chunk, "mine")}
        >
          Keep mine
        </Button>
      }
    />
  );
}

// Drop under a form control to render that field's conflict in place.
export default function ConflictCallout({ field }: { field: string }) {
  const ctx = useConflict();
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
