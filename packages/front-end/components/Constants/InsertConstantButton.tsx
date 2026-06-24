import React, {
  ReactElement,
  cloneElement,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import { CONSTANT_REF_PATTERN } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import ValueDisplay from "@/components/Features/ValueDisplay";

// Matches a `@const:<key>` reference in either syntax (string interpolation or
// JSON placeholder) within a feature value. Built from the shared pattern so it
// can't drift from the resolver/validators.
const CONST_REF_RE = new RegExp(CONSTANT_REF_PATTERN, "g");

// Constants eligible for a given field: string values only allow string
// constants; JSON values allow both. Scoped to the field's project (global
// constants always apply).
function filterEligibleConstants(
  constants: ConstantWithoutValue[],
  valueType: "string" | "json",
  project?: string,
): ConstantWithoutValue[] {
  const allowedTypes: ConstantWithoutValue["type"][] =
    valueType === "json" ? ["string", "json"] : ["string"];
  return constants.filter(
    (c) =>
      !c.archived &&
      allowedTypes.includes(c.type) &&
      (!c.project || !project || c.project === project),
  );
}

// Wraps a trigger element in a hover popover that previews the constant's
// resolved value (lazily fetched the first time it's hovered, since the
// definitions cache omits values). Does not steal focus, so it's safe inside
// menus.
function ConstantValuePreview({
  constant,
  children,
}: {
  constant: ConstantWithoutValue;
  children: ReactElement;
}) {
  const [hovered, setHovered] = useState(false);
  const { data } = useApi<{ constant: ConstantInterface }>(
    `/constants/${constant.id}`,
    { shouldRun: () => hovered },
  );
  const value = data?.constant?.value;

  const preview = !data ? (
    <Text size="small" color="text-low">
      Loading…
    </Text>
  ) : value ? (
    <Box style={{ minWidth: 220, maxWidth: 340 }}>
      <ValueDisplay
        value={value}
        type={constant.type}
        full
        showCopyButton={false}
        showFullscreenButton={false}
      />
    </Box>
  ) : (
    <Text size="small" color="text-low">
      <em>(empty)</em>
    </Text>
  );

  const trigger = cloneElement(children, {
    onMouseEnter: (e: React.MouseEvent) => {
      setHovered(true);
      (
        children.props as { onMouseEnter?: (e: React.MouseEvent) => void }
      ).onMouseEnter?.(e);
    },
  });

  return (
    <Popover openOnHover side="right" trigger={trigger} content={preview} />
  );
}

// A single picker row. `onInsert` returns whether the insert succeeded; on
// failure we keep the menu open and surface an inline "Insert failed" error
// below the row.
function ConstantOption({
  constant,
  onInsert,
}: {
  constant: ConstantWithoutValue;
  onInsert: (constant: ConstantWithoutValue) => boolean;
}) {
  const [failed, setFailed] = useState(false);
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleClick = () => {
    if (onInsert(constant)) return;
    if (failTimer.current) clearTimeout(failTimer.current);
    setFailed(true);
    failTimer.current = setTimeout(() => setFailed(false), 2000);
  };

  return (
    <DropdownMenuItem className="multiline-item" onClick={handleClick}>
      <Box width="100%">
        <ConstantValuePreview constant={constant}>
          {/* Single row: fixed name column | flexible @const:key | type. The key
              column flex-shrinks so the row never overflows the menu width; all
              columns truncate with an ellipsis rather than wrapping. */}
          <Flex align="center" gap="2" width="100%">
            <Box style={{ width: 120, flexShrink: 0 }}>
              <Text weight="medium">
                <OverflowText
                  maxWidth={120}
                  title={constant.name || constant.key}
                >
                  {constant.name || constant.key}
                </OverflowText>
              </Text>
            </Box>
            <Box
              title={`@const:${constant.key}`}
              style={{
                flexGrow: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "11px",
                color: "var(--color-text-low)",
              }}
            >
              @const:{constant.key}
            </Box>
            <Box style={{ flexShrink: 0 }}>
              <Text size="small" color="text-low">
                {constant.type === "json" ? "JSON" : "String"}
              </Text>
            </Box>
          </Flex>
        </ConstantValuePreview>
        {failed && (
          <HelperText status="error" size="md" mt="2">
            Couldn&rsquo;t insert here — place your cursor inside a{" "}
            {constant.type === "json" ? "JSON object or string" : "string"}{" "}
            value.
          </HelperText>
        )}
      </Box>
    </DropdownMenuItem>
  );
}

// Flex-wrapped tags for the valid constants referenced in a field's value, each
// with the same hover preview. Renders nothing when none are referenced.
export function UsedConstantTags({
  value,
  valueType,
  project,
}: {
  value: string;
  valueType: "string" | "json";
  project?: string;
}) {
  const { constants } = useDefinitions();

  const used = useMemo(() => {
    if (!value) return [];
    const byKey = new Map(
      filterEligibleConstants(constants, valueType, project).map((c) => [
        c.key,
        c,
      ]),
    );
    const seen = new Set<string>();
    const result: ConstantWithoutValue[] = [];
    const re = new RegExp(CONST_REF_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) {
      const key = m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const c = byKey.get(key);
      if (c) result.push(c);
    }
    return result;
  }, [value, constants, valueType, project]);

  if (!used.length) return null;

  return (
    <Flex align="center" wrap="wrap" gap="2">
      <Text size="small" color="text-low" weight="medium">
        Constants used:
      </Text>
      {used.map((c) => (
        <ConstantValuePreview key={c.id} constant={c}>
          <Link
            href={`/constants/${c.id}`}
            target="_blank"
            rel="noreferrer"
            underline="hover"
            style={{ display: "inline-flex" }}
          >
            <Badge
              variant="soft"
              color={c.type === "json" ? "violet" : "gray"}
              label={c.key}
            />
          </Link>
        </ConstantValuePreview>
      ))}
    </Flex>
  );
}

// Right-aligned picker for inserting a constant reference into a feature value.
// Renders nothing when there are no eligible constants.
export default function InsertConstantButton({
  valueType,
  project,
  onInsert,
  disabled,
  excludeKeys,
}: {
  valueType: "string" | "json";
  project?: string;
  // Returns whether the insertion succeeded (false → no valid spot, e.g. the
  // cursor isn't in/near a string or object), so we can surface a quick failure.
  onInsert: (constant: ConstantWithoutValue) => boolean;
  disabled?: boolean;
  // Keys to scrub from the options — the constant being edited and any that
  // would create a reference cycle.
  excludeKeys?: string[];
}) {
  const { constants } = useDefinitions();

  // Externally manage the open state so a failed insert keeps the menu open —
  // only a successful click closes it. A failed select still triggers Radix's
  // close, which `keepOpen` swallows once.
  const [open, setOpen] = useState(false);
  const keepOpen = useRef(false);
  const handleInsert = (c: ConstantWithoutValue): boolean => {
    const ok = onInsert(c);
    if (ok) setOpen(false);
    else keepOpen.current = true;
    return ok;
  };

  const hasConstants = useMemo(
    () => constants.some((c) => !c.archived),
    [constants],
  );

  const eligible = useMemo(() => {
    // `excludeKeys` is for keys that must never be offered (cycle prevention).
    // A constant already referenced elsewhere in the value is intentionally
    // still offered — referencing the same constant in multiple places is valid
    // (it's not a limit-1 situation), so we don't dedupe on current usage.
    const exclude = new Set(excludeKeys ?? []);
    return filterEligibleConstants(constants, valueType, project)
      .filter((c) => !exclude.has(c.key))
      .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
  }, [constants, project, valueType, excludeKeys]);

  // Hide the control entirely only when the org has no constants at all. When
  // constants exist but none apply here (wrong type/project, or all scrubbed by
  // cycle/self), the menu shows an empty state so it's clear it's not broken.
  if (!hasConstants) return null;

  return (
    <DropdownMenu
      variant="soft"
      menuPlacement="end"
      menuSide="top"
      menuWidth={340}
      open={open}
      onOpenChange={(o) => {
        // Swallow the close that Radix fires after a failed select.
        if (!o && keepOpen.current) {
          keepOpen.current = false;
          return;
        }
        setOpen(o);
      }}
      trigger={
        <Button variant="ghost" size="xs" disabled={disabled}>
          <Flex align="center" gap="1">
            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
              {"{"}
              <span style={{ color: "var(--ruby-11)" }}>@</span>
              {"}"}
            </span>{" "}
            Insert constant
          </Flex>
        </Button>
      }
    >
      {eligible.length ? (
        <>
          {eligible.map((c) => (
            <ConstantOption key={c.id} constant={c} onInsert={handleInsert} />
          ))}
          <Box
            px="3"
            pt="2"
            mt="1"
            style={{ borderTop: "1px solid var(--gray-a4)" }}
          >
            <Text size="small" color="text-low">
              Wrap a reference in backticks to keep it literal.
            </Text>
          </Box>
        </>
      ) : (
        <DropdownMenuItem disabled onClick={() => undefined}>
          <Text size="small" color="text-low">
            No available constants
          </Text>
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}
