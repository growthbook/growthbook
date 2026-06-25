import React, {
  ReactElement,
  cloneElement,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConstantInterface, ConstantWithoutValue } from "shared/types/constant";
import { CONSTANT_REF_PATTERN } from "shared/validators";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import ValueDisplay from "@/components/Features/ValueDisplay";

// Built from the shared pattern so it can't drift from the resolver/validators.
const CONST_REF_RE = new RegExp(CONSTANT_REF_PATTERN, "g");

// String values only allow string constants; JSON values allow both.
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

// Hover popover previewing the constant's value (lazily fetched, since the
// definitions cache omits values). Doesn't steal focus, so it's safe in menus.
function ConstantValuePreview({
  constant,
  children,
}: {
  constant: ConstantWithoutValue;
  children: ReactElement;
}) {
  const [hovered, setHovered] = useState(false);
  const { data } = useApi<{ constant: ConstantInterface }>(
    `/constants/${constant.key}`,
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
        type={constant.type === "string" ? "string" : "json"}
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

// `onInsert` returns whether the insert succeeded; on failure we surface an
// inline error and keep the menu open.
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
          {/* Columns truncate with an ellipsis so the row never overflows. */}
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
            {constant.type === "json"
              ? "Couldn’t add this — the value must be a valid JSON object."
              : "Couldn’t insert here — place your cursor inside a string value."}
          </HelperText>
        )}
      </Box>
    </DropdownMenuItem>
  );
}

// Tags for the constants referenced in a field's value, each with a preview.
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
            href={`/constants/${c.key}`}
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

export default function InsertConstantButton({
  valueType,
  project,
  onInsert,
  disabled,
  excludeKeys,
  iconOnly = false,
}: {
  valueType: "string" | "json";
  project?: string;
  // Returns whether the insertion succeeded (false → no valid spot for it).
  onInsert: (constant: ConstantWithoutValue) => boolean;
  disabled?: boolean;
  // Keys to scrub from the options (self + cycle prevention).
  excludeKeys?: string[];
  // Compact icon-only trigger for inline (beside-the-field) layouts.
  iconOnly?: boolean;
}) {
  const { constants } = useDefinitions();

  // Manage open state so a failed insert keeps the menu open; keepOpen swallows
  // the one close Radix fires after the failed select.
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
    // Already-referenced constants stay offered — reusing one is valid.
    const exclude = new Set(excludeKeys ?? []);
    return filterEligibleConstants(constants, valueType, project)
      .filter((c) => !exclude.has(c.key))
      .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
  }, [constants, project, valueType, excludeKeys]);

  // Hide only when the org has no constants; otherwise show an empty-state menu.
  if (!hasConstants) return null;

  const glyph = (
    <span style={{ fontFamily: "monospace", fontWeight: 500 }}>
      {"{"}
      <span style={{ color: "var(--ruby-11)" }}>@</span>
      {"}"}
    </span>
  );

  // Tooltip wraps only the icon so it doesn't interfere with the menu.
  const trigger = iconOnly ? (
    <IconButton
      type="button"
      size="2"
      variant="ghost"
      color="gray"
      disabled={disabled}
      ml="1"
      mt="2"
    >
      <Tooltip content="Insert constant">
        <Flex align="center" justify="center">
          {glyph}
        </Flex>
      </Tooltip>
    </IconButton>
  ) : (
    <Button variant="ghost" size="xs" disabled={disabled}>
      <Flex align="center" gap="1">
        {glyph} Insert constant
      </Flex>
    </Button>
  );

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
      trigger={trigger}
    >
      {eligible.length ? (
        eligible.map((c) => (
          <ConstantOption key={c.id} constant={c} onInsert={handleInsert} />
        ))
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
