import {
  FeatureInterface,
  FeatureTestResult,
  FeatureValueType,
} from "shared/types/feature";
import React, {
  CSSProperties,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconButton } from "@radix-ui/themes";
import { PiCheck, PiCopy } from "react-icons/pi";
import { parsePlainJSONObject } from "shared/util";
import InlineCode, {
  LinkifyConfig,
} from "@/components/SyntaxHighlighting/InlineCode";
import VirtualizedCode, {
  isLongCode,
  RenderInFullContext,
} from "@/components/SyntaxHighlighting/VirtualizedCode";
import { useConstantLinkify } from "@/components/Constants/useConstantLinkify";
import styles from "@/components/Archetype/ArchetypeResults.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import UITooltip from "@/ui/Tooltip";
import { parseFeatureResult } from "@/hooks/useArchetype";
import Modal from "@/components/Modal";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";
import ScrollArea from "@/ui/ScrollArea";
import Text from "@/ui/Text";
import { CopyIcon, FullscreenIcon } from "@/ui/ActionIcons";
import CornerActions, { ActionsOverlay } from "./CornerActions";
import { useValueDiff } from "./ValueDiffContext";
import { formatJsonValue, getFieldLineNumbers } from "./jsonFieldLines";

// For sparse JSON rules, the stored `value` is only the patch. We display the
// fully expanded value (default merged with the patch) and bold the keys that
// the rule actually overrides. Returns null when the value isn't a plain object
// (sparse is then a no-op and the value renders normally).
function getSparseMerge(
  value: string,
  defaultValue: string | undefined,
): { merged: Record<string, unknown>; patchKeys: Set<string> } | null {
  const patch = parsePlainJSONObject(value);
  if (!patch) return null;
  const defaultObj = parsePlainJSONObject(defaultValue ?? "") ?? {};
  return {
    merged: { ...defaultObj, ...patch },
    patchKeys: new Set(Object.keys(patch)),
  };
}

// A value as one of several in a list, kept short.
const BOOLEAN_ON = "var(--green-9)";
const BOOLEAN_OFF = "var(--gray-7)";

// A boolean's dot: true, false, or true for only some users. Empty is
// nothing served at all.
export function BooleanDot({
  fill,
}: {
  fill: "on" | "off" | "split" | "empty";
}) {
  return (
    <span
      style={{
        flexShrink: 0,
        alignSelf: "center",
        boxSizing: "border-box",
        height: 10,
        width: 10,
        borderRadius: "50%",
        border: fill === "empty" ? "1.5px solid var(--gray-8)" : undefined,
        background:
          fill === "split"
            ? `linear-gradient(90deg, ${BOOLEAN_ON} 50%, ${BOOLEAN_OFF} 50%)`
            : fill === "on"
              ? BOOLEAN_ON
              : fill === "off"
                ? BOOLEAN_OFF
                : undefined,
      }}
    />
  );
}

export const LISTED_VALUE_STYLE: CSSProperties = {
  maxHeight: 100,
  overflowY: "auto",
  maxWidth: "100%",
};

export default function ValueDisplay({
  value,
  type,
  full = true,
  additionalStyle = {},
  fullStyle = { maxHeight: 150, overflowY: "auto", maxWidth: "100%" },
  fullClassName = "",
  showFullscreenButton: _showFullscreenButton = false,
  showCopyButton = true,
  copyButtonClassName,
  isFullscreen = false,
  actionsOverlay,
  sparse = false,
  defaultValue,
  fullscreenHeader = "Feature Value",
  linkify,
  lineHeight,
  monochrome,
  split = false,
  extraActions,
}: {
  value: string;
  type: FeatureValueType;
  full?: boolean;
  additionalStyle?: CSSProperties;
  fullStyle?: CSSProperties;
  fullClassName?: string;
  showFullscreenButton?: boolean;
  showCopyButton?: boolean;
  // Optional class on the copy button — lets a caller fade/reveal it (e.g. on
  // row hover) without affecting other ValueDisplay usages.
  copyButtonClassName?: string;
  isFullscreen?: boolean;
  actionsOverlay?: ActionsOverlay;
  // Header for the fullscreen modal (e.g. "Constant Value" when reused outside features).
  fullscreenHeader?: string;
  // When true (JSON rules flagged sparse), `value` is a partial patch. We show
  // the expanded value (default + patch) with the patched keys in bold.
  sparse?: boolean;
  // The feature's default value, used to expand a sparse patch.
  defaultValue?: string;
  // Overrides the default constant linkify (matching `@const:` references render
  // as links to the referenced constant). Rarely needed — pass to customize or,
  // with a no-op getHref, effectively disable linking.
  linkify?: LinkifyConfig;
  // Override the rendered code line height (passed through to InlineCode).
  lineHeight?: number;
  monochrome?: boolean;
  // A boolean served to only some users: its dot is half filled.
  split?: boolean;
  // More buttons in the same row as copy and fullscreen, after them.
  extraActions?: ReactNode;
}) {
  // Link `@const:` references to their constant by default on every surface that
  // renders a value, unless the caller supplies its own linkify config.
  const constantLinkify = useConstantLinkify();
  const resolvedLinkify = linkify ?? constantLinkify;

  const [modalOpen, setModalOpen] = useState(false);
  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });
  const sparseMerge = useMemo(
    () =>
      sparse && type === "json" ? getSparseMerge(value, defaultValue) : null,
    [sparse, type, value, defaultValue],
  );
  // Beside other values (an experiment's variations), what differs between
  // them is tinted instead.
  const shown = useMemo(
    () =>
      type === "json"
        ? (sparseMerge?.merged ?? parsePlainJSONObject(value))
        : null,
    [type, sparseMerge, value],
  );
  const differingKeys = useValueDiff(isFullscreen ? null : shown);
  // Bolded or tinted keys each keep their own lines.
  const keysOnOwnLines = !!sparseMerge || !!differingKeys?.size;
  const formatted = useMemo(() => {
    if (type === "boolean") return value;
    if (type === "number") return value || "null";
    if (type === "string") return '"' + value + '"';
    try {
      // Sparse rules display the expanded (merged) value, not the raw patch.
      return formatJsonValue(sparseMerge?.merged ?? JSON.parse(value), {
        keysOnOwnLines,
      });
    } catch (e) {
      return value;
    }
  }, [value, type, sparseMerge, keysOnOwnLines]);

  // Long values highlight only the visible lines, inside a box that scrolls
  // even when the caller set no height limit
  const renderInFull = useContext(RenderInFullContext);
  const virtualize = useMemo(
    () => !renderInFull && isLongCode(formatted),
    [renderInFull, formatted],
  );
  const boxStyle =
    virtualize &&
    fullStyle.maxHeight === undefined &&
    fullStyle.height === undefined
      ? { ...fullStyle, maxHeight: "70vh", overflowY: "auto" as const }
      : fullStyle;

  // 1-based line numbers of the overridden keys, bolded in the expanded value.
  const boldLines = useMemo(
    () =>
      sparseMerge ? getFieldLineNumbers(formatted, sparseMerge.patchKeys) : [],
    [sparseMerge, formatted],
  );

  const highlightLines = useMemo(
    () => (differingKeys ? getFieldLineNumbers(formatted, differingKeys) : []),
    [differingKeys, formatted],
  );
  const emphasizedLines = differingKeys ? highlightLines : boldLines;

  // The first emphasized line can sit far down a tall object that's clipped by
  // the fixed-height scroll box. When it's out of view, scroll it near the top
  // (with a line of padding above). The content is a lazily-loaded syntax
  // highlighter, so poll on animation frames until it has rendered enough to be
  // scrollable, scroll once, then stop (bounded so a short, non-scrollable value
  // doesn't poll forever).
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!emphasizedLines.length) return;
    const el = scrollBoxRef.current;
    if (!el) return;
    const firstEmphasized = Math.min(...emphasizedLines);
    const totalLines = formatted.split("\n").length;
    let raf = 0;
    let attempts = 0;
    const tryScroll = () => {
      if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
        const rowHeight = el.scrollHeight / totalLines;
        if (firstEmphasized * rowHeight <= el.clientHeight) return;
        const targetLine = Math.max(0, firstEmphasized - 2); // 0-based, minus a line of padding
        el.scrollTop = targetLine * rowHeight;
        return;
      }
      if (++attempts < 90) raf = requestAnimationFrame(tryScroll);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [emphasizedLines, formatted]);

  const showFullscreenButton = _showFullscreenButton && type === "json";

  if (type === "boolean") {
    const on = !(value === "false" || value === "null" || !value);
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
        }}
      >
        <BooleanDot fill={split ? "split" : on ? "on" : "off"} />
        <span
          style={{
            color: on ? "var(--green-11)" : "var(--color-text-low)",
            fontSize: "var(--font-size-2)",
          }}
        >
          <Text mono size="inherit" weight="semibold">
            {on ? "true" : "false"}
          </Text>
        </span>
      </span>
    );
  }

  if (!full) {
    return (
      <div
        style={{
          textOverflow: "ellipsis",
          overflow: "hidden",
          maxWidth: "180px",
          whiteSpace: "nowrap",
          ...additionalStyle,
        }}
        className="text-muted"
      >
        {formatted}
      </div>
    );
  }

  return (
    <>
      <CornerActions
        // Only the lines near the viewport render when it's long, so it can't
        // hug its widest line without a long one widening it mid-scroll: it
        // takes the full width instead.
        overlay={
          virtualize && actionsOverlay?.inline
            ? { ...actionsOverlay, inline: false }
            : actionsOverlay
        }
        oneLine={!formatted.includes("\n")}
        actions={
          isFullscreen ? null : (
            <>
              {showCopyButton && (type === "json" || type === "string") ? (
                <UITooltip
                  content={copySuccess ? "Copied" : "Copy to clipboard"}
                >
                  <IconButton
                    type="button"
                    radius="full"
                    variant="ghost"
                    className={copyButtonClassName}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!copySuccess) {
                        performCopy(sparseMerge ? formatted : value);
                      }
                    }}
                  >
                    <CopyIcon copied={copySuccess} size="sm" />
                  </IconButton>
                </UITooltip>
              ) : null}
              {showFullscreenButton && (
                <UITooltip content="View in full screen">
                  <IconButton
                    type="button"
                    radius="full"
                    variant="ghost"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setModalOpen(true);
                    }}
                  >
                    <FullscreenIcon size="sm" />
                  </IconButton>
                </UITooltip>
              )}
              {extraActions}
            </>
          )
        }
      >
        {/* The gutter keeps highlighted lines clear of the scrollbar. */}
        <ScrollArea
          ref={scrollBoxRef}
          gutter
          edgeCue="fade"
          className={fullClassName}
          style={{
            maxHeight: boxStyle.maxHeight,
            minHeight: boxStyle.minHeight,
            height: boxStyle.height,
            maxWidth: boxStyle.maxWidth,
          }}
        >
          {virtualize ? (
            <VirtualizedCode
              scrollRef={scrollBoxRef}
              language="json"
              code={formatted}
              boldLines={sparseMerge && !differingKeys ? boldLines : undefined}
              highlightLines={highlightLines}
              linkify={resolvedLinkify}
              lineHeight={lineHeight}
              monochrome={monochrome}
            />
          ) : (
            <InlineCode
              language="json"
              code={formatted}
              boldLines={sparseMerge && !differingKeys ? boldLines : undefined}
              highlightLines={highlightLines}
              linkify={resolvedLinkify}
              lineHeight={lineHeight}
              monochrome={monochrome}
            />
          )}
        </ScrollArea>
      </CornerActions>
      {modalOpen && (
        <Modal
          header={fullscreenHeader}
          open={modalOpen}
          close={() => setModalOpen(false)}
          trackingEventModalType=""
          size="max"
          sizeY="max"
          secondaryCTA={
            copySuccess ? (
              <Button style={{ width: 100 }} icon={<PiCheck />} color="gray">
                Copied
              </Button>
            ) : (
              <Button
                style={{ width: 100 }}
                icon={<PiCopy />}
                onClick={() => {
                  if (!copySuccess)
                    performCopy(sparseMerge ? formatted : value);
                }}
              >
                Copy
              </Button>
            )
          }
          closeCta="Close"
        >
          <ValueDisplay
            value={value}
            type={type}
            full={true}
            fullStyle={{ minHeight: 400, maxWidth: "100%" }}
            isFullscreen={true}
            sparse={sparse}
            defaultValue={defaultValue}
            linkify={resolvedLinkify}
            lineHeight={lineHeight}
          />
        </Modal>
      )}
    </>
  );
}

export function ArchetypeValueDisplay({
  result,
  feature,
}: {
  result: FeatureTestResult;
  feature: { valueType: FeatureInterface["valueType"] };
}) {
  const { matchedRuleName, brief, debugLog } = parseFeatureResult(result);
  return (
    <Tooltip
      className="d-inline-block text-left"
      flipTheme={false}
      body={
        <div className="text-left">
          {!result.enabled ? (
            <div className="text-center p-2 text-muted">
              Feature disabled for this environment
            </div>
          ) : (
            <div className="">
              <span className="text-muted">Matched rule:</span>{" "}
              <strong>{matchedRuleName}</strong>
            </div>
          )}
          {debugLog.length > 0 && (
            <>
              <h5
                className="mt-3 position-relative text-muted"
                style={{ top: "4px" }}
              >
                Debug Log
              </h5>
              <div className={`border bg-light border-light rounded px-3 py-1`}>
                {debugLog.map((log: string, i) => (
                  <div className="row align-items-center my-3" key={i}>
                    <div
                      className={` text-left ${
                        result?.result?.source === "defaultValue" &&
                        i === debugLog.length - 1
                          ? ""
                          : "col-2"
                      }`}
                    >
                      {result?.result?.source === "defaultValue" &&
                      i === debugLog.length - 1 ? (
                        <></>
                      ) : (
                        <div
                          key={i}
                          className={`text-light border rounded-circle bg-purple ${styles.ruleCircle}`}
                          style={{
                            width: 28,
                            height: 28,
                            lineHeight: "26px",
                            textAlign: "center",
                            fontWeight: "bold",
                          }}
                        >
                          {i + 1}
                        </div>
                      )}
                    </div>
                    <div className="col text-left">{log}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      }
    >
      <div className="text-left">
        <div>
          {result.enabled ? (
            <ValueDisplay
              value={
                typeof result.result?.value === "string"
                  ? result.result.value
                  : JSON.stringify(result.result?.value ?? null)
              }
              type={feature.valueType}
              full={true}
              showCopyButton={false}
            />
          ) : (
            <span className="text-muted">disabled</span>
          )}
        </div>
        <span className="text-muted small">{brief}</span>
      </div>
    </Tooltip>
  );
}
