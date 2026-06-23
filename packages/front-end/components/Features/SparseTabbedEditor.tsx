import { ReactNode, useEffect, useState } from "react";
import type { Ace } from "ace-builds";
import { Box, Flex } from "@radix-ui/themes";
import { FaMagic } from "react-icons/fa";
import clsx from "clsx";
import { FeatureValueType } from "shared/types/feature";
import { formatJSON } from "@/services/features";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import CodeTextArea, {
  TEN_LINES_HEIGHT,
} from "@/components/Forms/CodeTextArea";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { SparsePatchIndicator } from "@/components/Features/SparsePatchToggle";

// Edit/Preview tabs for a sparse JSON rule value. The Edit tab is the JSON code
// editor; the Preview tab shows the expanded value (default + patch) with the
// overridden keys emphasized. Available both inline and in a fullscreen overlay.
export default function SparseTabbedEditor({
  value,
  setValue,
  valueType,
  defaultValue,
  label,
  placeholder,
  disabled = false,
  defaultHeight,
  showInlineLabel = true,
  condensed = false,
  onEditorLoad,
  usedConstantTags,
}: {
  value: string;
  setValue: (v: string) => void;
  valueType: FeatureValueType;
  // Feature default value the patch is merged onto for the preview.
  defaultValue?: string;
  label?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  defaultHeight?: number;
  // Render the label above the tabs. Set false when a parent already shows it
  // (e.g. the force/rollout toggle header row).
  showInlineLabel?: boolean;
  // Tighter layout for embedded contexts like ramp step editors: smaller tabs
  // and a shorter default editor height.
  condensed?: boolean;
  // Exposes the Edit-tab Ace editor so a parent's constant picker can insert at
  // the cursor (the Edit tab is force-mounted so this stays valid on Preview).
  onEditorLoad?: (editor: Ace.Editor) => void;
  // "Constants used:" legend for the references in the current value, shown in
  // the Edit-tab footer beside Format JSON.
  usedConstantTags?: ReactNode;
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [fullscreen, setFullscreen] = useState(false);

  // Sparse patches are small, so default to ~half the normal editor height
  // (or shorter still when condensed). A caller-provided height is an explicit
  // override — respect it as-is.
  const sparseDefaultHeight =
    defaultHeight ?? (condensed ? 64 : Math.round(TEN_LINES_HEIGHT / 2));
  // Use the compact tab size everywhere except fullscreen — the larger size 2
  // strip is needlessly tall above the editor.
  const tabsSize: "1" | "2" = fullscreen ? "2" : "1";

  // Escape exits fullscreen (mirrors CodeTextArea's behavior).
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setFullscreen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [fullscreen]);

  // Lock scrolling on the underlying page while the fullscreen overlay is open.
  useEffect(() => {
    if (!fullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  const formatted = formatJSON(value);
  const formatJSONButton = (
    <a
      href="#"
      className={clsx("text-purple", {
        "text-muted cursor-default no-underline":
          !formatted || formatted === value,
      })}
      onClick={(e) => {
        e.preventDefault();
        if (formatted && formatted !== value) setValue(formatted);
      }}
      style={{ whiteSpace: "nowrap" }}
    >
      <FaMagic /> Format JSON
    </a>
  );

  const tabs = (
    <Tabs
      value={tab}
      onValueChange={(t) => setTab(t === "preview" ? "preview" : "edit")}
      // Let the editor tab fill the fullscreen overlay.
      style={
        fullscreen
          ? { flex: 1, display: "flex", flexDirection: "column" }
          : undefined
      }
    >
      <Flex align="center" justify="between">
        <TabsList size={tabsSize}>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        {fullscreen ? (
          <Button
            type="button"
            size="xs"
            color="gray"
            variant="ghost"
            onClick={() => setFullscreen(false)}
          >
            Exit full screen (ESC)
          </Button>
        ) : null}
      </Flex>
      <Box pt="2" style={fullscreen ? { flex: 1, minHeight: 0 } : undefined}>
        <TabsContent
          value="edit"
          // Keep the editor mounted on the Preview tab so the parent's constant
          // picker can still insert at the cursor (and live-update the preview).
          forceMount
          style={fullscreen ? { height: "100%" } : undefined}
        >
          <CodeTextArea
            language="json"
            value={value}
            setValue={setValue}
            helpText={
              fullscreen ? undefined : (
                <Flex align="start" justify="between" gap="3" width="100%">
                  <Box flexGrow="1" style={{ minWidth: 0 }}>
                    {usedConstantTags}
                  </Box>
                  <Box flexShrink="0">{formatJSONButton}</Box>
                </Flex>
              )
            }
            placeholder={placeholder}
            disabled={disabled}
            resizable={!fullscreen}
            fullHeight={fullscreen}
            defaultHeight={sparseDefaultHeight}
            showCopyButton={true}
            showFullscreenButton={!fullscreen}
            onRequestFullscreen={() => setFullscreen(true)}
            onEditorLoad={onEditorLoad}
          />
        </TabsContent>
        <TabsContent value="preview">
          <ValueDisplay
            value={value}
            type={valueType}
            sparse={true}
            defaultValue={defaultValue}
            full={true}
            fullStyle={
              fullscreen
                ? { minHeight: 300, maxWidth: "100%" }
                : { maxHeight: 150, overflowY: "auto", maxWidth: "100%" }
            }
          />
        </TabsContent>
      </Box>
    </Tabs>
  );

  return (
    <div
      style={
        fullscreen
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 1050,
              backgroundColor: "var(--color-surface-solid)",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
            }
          : undefined
      }
    >
      {fullscreen ? (
        <Flex align="center" gap="3" mb="2">
          {label ? <Box className="font-weight-bold">{label}</Box> : null}
          <SparsePatchIndicator />
        </Flex>
      ) : showInlineLabel && label ? (
        <Box mb="1">
          <Text as="label" weight="semibold" mb="0">
            {label}
          </Text>
        </Box>
      ) : null}
      {tabs}
    </div>
  );
}
