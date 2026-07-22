import {
  FeatureInterface,
  FeatureTestResult,
  FeatureValueType,
} from "shared/types/feature";
import React, {
  CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import stringify from "json-stringify-pretty-compact";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCheck, PiCornersOut, PiCopy } from "react-icons/pi";
import { parsePlainJSONObject } from "shared/util";
import InlineCode, {
  LinkifyConfig,
} from "@/components/SyntaxHighlighting/InlineCode";
import { useConstantLinkify } from "@/components/Constants/useConstantLinkify";
import styles from "@/components/Archetype/ArchetypeResults.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import { parseFeatureResult } from "@/hooks/useArchetype";
import Modal from "@/components/Modal";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";

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

// Given fully-expanded (one-key-per-line) JSON and the set of patched keys,
// returns the 1-based line numbers that make up those keys' entries — including
// the continuation lines of multi-line (nested) values. Top-level keys sit at a
// 2-space indent; a line at column 0 (the closing brace) ends the object.
function getBoldLineNumbers(
  formatted: string,
  patchKeys: Set<string>,
): number[] {
  const bold: number[] = [];
  let inPatchedEntry = false;
  formatted.split("\n").forEach((line, i) => {
    const topLevelKey = line.match(/^ {2}"([^"]+)":/);
    if (topLevelKey) {
      inPatchedEntry = patchKeys.has(topLevelKey[1]);
    } else if (/^[}\]]/.test(line)) {
      inPatchedEntry = false;
    }
    if (inPatchedEntry) bold.push(i + 1);
  });
  return bold;
}

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
  sparse = false,
  defaultValue,
  fullscreenHeader = "Feature Value",
  linkify,
  fontSize,
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
  // Override the rendered code font size (passed through to InlineCode).
  fontSize?: string;
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
  const formatted = useMemo(() => {
    if (type === "boolean") return value;
    if (type === "number") return value || "null";
    if (type === "string") return '"' + value + '"';
    try {
      // Sparse rules display the expanded (merged) value, not the raw patch.
      // Force one-key-per-line (maxLength: 0) so the overridden keys map to
      // stable line numbers we can bold.
      // Always break to one key/element per line (never compact short objects
      // onto a single line) for consistent, scannable JSON.
      if (sparseMerge) return stringify(sparseMerge.merged, { maxLength: 0 });
      return stringify(JSON.parse(value), { maxLength: 0 });
    } catch (e) {
      return value;
    }
  }, [value, type, sparseMerge]);

  // 1-based line numbers of the overridden keys, bolded in the expanded value.
  const boldLines = useMemo(
    () =>
      sparseMerge ? getBoldLineNumbers(formatted, sparseMerge.patchKeys) : [],
    [sparseMerge, formatted],
  );

  // For sparse values the override can sit far down a tall object that's
  // clipped by the fixed-height scroll box. Scroll it so the first highlighted
  // line is near the top (with a line of padding above). The content is a
  // lazily-loaded syntax highlighter, so poll on animation frames until it has
  // rendered enough to be scrollable, scroll once, then stop (bounded so a
  // short, non-scrollable value doesn't poll forever).
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!boldLines.length) return;
    const el = scrollBoxRef.current;
    if (!el) return;
    const firstBold = Math.min(...boldLines);
    const totalLines = formatted.split("\n").length;
    let raf = 0;
    let attempts = 0;
    const tryScroll = () => {
      if (el.scrollHeight > el.clientHeight + 1) {
        const targetLine = Math.max(0, firstBold - 2); // 0-based, minus a line of padding
        el.scrollTop = (targetLine / totalLines) * el.scrollHeight;
        return;
      }
      if (++attempts < 90) raf = requestAnimationFrame(tryScroll);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [boldLines, formatted]);

  const showFullscreenButton = _showFullscreenButton && type === "json";

  if (type === "boolean") {
    const on = !(value === "false" || value === "null" || !value);
    return (
      <span className="text-gray font-weight-bold">
        <div
          style={{
            display: "inline-block",
            height: 10,
            width: 10,
            borderRadius: 10,
            marginRight: 5,
            backgroundColor: on ? "#3aa8e8" : "#cccccc",
          }}
        ></div>
        {on ? "TRUE" : "FALSE"}
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
      <Box position="relative">
        <Box ref={scrollBoxRef} style={fullStyle} className={fullClassName}>
          <InlineCode
            language="json"
            code={formatted}
            boldLines={sparseMerge ? boldLines : undefined}
            linkify={resolvedLinkify}
            fontSize={fontSize}
          />
        </Box>
        {!isFullscreen && (
          <Flex
            align="center"
            gap="3"
            style={{
              position: "absolute",
              bottom: -4,
              right: 16,
            }}
          >
            {showCopyButton && (type === "json" || type === "string") ? (
              <Tooltip
                body={copySuccess ? "Copied" : "Copy to clipboard"}
                usePortal={true}
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
                  {copySuccess ? <PiCheck size={12} /> : <PiCopy size={12} />}
                </IconButton>
              </Tooltip>
            ) : null}
            {showFullscreenButton && type === "json" && (
              <Tooltip body="View in full screen" usePortal={true}>
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
                  <PiCornersOut size={12} />
                </IconButton>
              </Tooltip>
            )}
          </Flex>
        )}
      </Box>
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
            fontSize={fontSize}
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
