import {
  FeatureInterface,
  FeatureTestResult,
  FeatureValueType,
} from "back-end/types/feature";
import React, { CSSProperties, useMemo, useState } from "react";
import stringify from "json-stringify-pretty-compact";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiCheck, PiCornersOut, PiCopy } from "react-icons/pi";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import styles from "@/components/Archetype/ArchetypeResults.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import { parseFeatureResult } from "@/hooks/useArchetype";
import Modal from "@/components/Modal";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Button from "@/ui/Button";

export default function ValueDisplay({
  value,
  type,
  full = true,
  additionalStyle = {},
  fullStyle = { maxHeight: 150, overflowY: "auto", maxWidth: "100%" },
  fullClassName = "",
  showFullscreenButton: _showFullscreenButton = false,
  showCopyButton = true,
  isFullscreen = false,
}: {
  value: string;
  type: FeatureValueType;
  full?: boolean;
  additionalStyle?: CSSProperties;
  fullStyle?: CSSProperties;
  fullClassName?: string;
  showFullscreenButton?: boolean;
  showCopyButton?: boolean;
  isFullscreen?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });
  const formatted = useMemo(() => {
    if (type === "boolean") return value;
    if (type === "number") return value || "null";
    if (type === "string") return '"' + value + '"';
    try {
      return stringify(JSON.parse(value));
    } catch (e) {
      return value;
    }
  }, [value, type]);

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
      <div style={{ position: "relative" }}>
        <div style={fullStyle} className={fullClassName}>
          <InlineCode language="json" code={formatted} />
        </div>
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
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!copySuccess) performCopy(value);
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
      </div>
      {modalOpen && (
        <Modal
          header="Feature Value"
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
                  if (!copySuccess) performCopy(value);
                }}
              >
                Copy
              </Button>
            )
          }
          closeCta="Close"
          useRadixButton={true}
        >
          <ValueDisplay
            value={value}
            type={type}
            full={true}
            fullStyle={{ minHeight: 400, maxWidth: "100%" }}
            isFullscreen={true}
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
  feature: FeatureInterface;
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
