import { ReactNode, useEffect, useRef, useState } from "react";
import type { Ace } from "ace-builds";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureValueType } from "shared/types/feature";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { Size } from "@/ui/sizes";
import CodeTextArea, {
  TEN_LINES_HEIGHT,
} from "@/components/Forms/CodeTextArea";
import Button from "@/ui/Button";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { SparsePatchIndicator } from "@/components/Features/SparsePatchToggle";
import { useReportedJsonValue } from "@/components/Features/ValueDiffContext";
import FormatJsonAction from "@/components/Features/FormatJsonAction";

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
  condensed = false,
  headerLeft,
  headerRight,
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
  // Tighter layout for embedded contexts like ramp step editors: smaller tabs
  // and a shorter default editor height.
  condensed?: boolean;
  // Rendered on the tab row, either side of the tabs.
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  // Exposes the Edit-tab Ace editor so a parent's constant picker can insert at
  // the cursor (the Edit tab is force-mounted so this stays valid on Preview).
  onEditorLoad?: (editor: Ace.Editor) => void;
  // "Constants used:" legend for the references in the current value, shown in
  // the Edit-tab footer beside Format JSON.
  usedConstantTags?: ReactNode;
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const editorRef = useRef<Ace.Editor | null>(null);
  // Preview takes the Edit box's height, resized or not, so switching tabs
  // doesn't jump.
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  // The patch is already just the changes, so only Preview marks where the
  // variations differ.
  useReportedJsonValue(value, defaultValue ?? "");
  const [fullscreen, setFullscreen] = useState(false);

  // Sparse patches are small, so default to ~half the normal editor height
  // (or shorter still when condensed). A caller-provided height is an explicit
  // override — respect it as-is.
  const sparseDefaultHeight =
    defaultHeight ?? (condensed ? 64 : Math.round(TEN_LINES_HEIGHT / 2));
  // Use the compact tab size everywhere except fullscreen — the larger size 2
  // strip is needlessly tall above the editor.
  const tabsSize: Size<"sm" | "md"> = fullscreen ? "md" : "sm";

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

  const tabs = (
    <Tabs
      value={tab}
      onValueChange={(t) => {
        if (t === "preview") {
          setPreviewHeight(
            editorRef.current?.container.parentElement?.offsetHeight ?? null,
          );
        }
        setTab(t === "preview" ? "preview" : "edit");
      }}
      // Let the editor tab fill the fullscreen overlay.
      style={
        fullscreen
          ? { flex: 1, display: "flex", flexDirection: "column" }
          : undefined
      }
    >
      <Flex align="center" justify="between" gap="3">
        <Flex align="center" gap="4" minWidth="0">
          {!fullscreen && headerLeft}
          <TabsList size={tabsSize}>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
        </Flex>
        {!fullscreen && headerRight ? (
          <Box flexShrink="0">{headerRight}</Box>
        ) : null}
        {fullscreen ? (
          <Button
            type="button"
            size="sm"
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
            helpText={fullscreen ? undefined : usedConstantTags}
            actions={
              disabled ? null : (
                <FormatJsonAction value={value} setValue={setValue} />
              )
            }
            placeholder={placeholder}
            disabled={disabled}
            resizable={!fullscreen}
            fullHeight={fullscreen}
            defaultHeight={sparseDefaultHeight}
            slimGutter
            showCopyButton={true}
            showFullscreenButton={!fullscreen}
            onRequestFullscreen={() => setFullscreen(true)}
            onEditorLoad={(e) => {
              editorRef.current = e;
              onEditorLoad?.(e);
            }}
            matchValueDisplay
          />
        </TabsContent>
        <TabsContent value="preview">
          {/* In the Edit box's frame, so the tabs read as one view. */}
          <Box
            px="1"
            style={{
              background: "var(--color-panel-solid)",
              border: "1px solid var(--border-color-200)",
              borderRadius: "0.25rem",
            }}
          >
            <ValueDisplay
              value={value}
              type={valueType}
              sparse={true}
              defaultValue={defaultValue}
              full={true}
              fullStyle={
                fullscreen
                  ? { minHeight: 300, maxWidth: "100%" }
                  : {
                      // Inside its 1px borders.
                      height: (previewHeight ?? sparseDefaultHeight) - 2,
                      maxWidth: "100%",
                    }
              }
            />
          </Box>
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
      ) : null}
      {tabs}
    </div>
  );
}
