import { ReactNode, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import { FaMagic } from "react-icons/fa";
import clsx from "clsx";
import { FeatureValueType } from "shared/types/feature";
import { formatJSON } from "@/services/features";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import CodeTextArea, {
  TEN_LINES_HEIGHT,
} from "@/components/Forms/CodeTextArea";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { SPARSE_PATCH_HELP } from "@/components/Features/SparsePatchToggle";

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
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [fullscreen, setFullscreen] = useState(false);

  // Sparse patches are small, so the editor only needs ~half the normal height.
  const sparseDefaultHeight = Math.round(
    (defaultHeight ?? TEN_LINES_HEIGHT) / 2,
  );

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
        <TabsList>
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
          style={fullscreen ? { height: "100%" } : undefined}
        >
          <CodeTextArea
            language="json"
            value={value}
            setValue={setValue}
            helpText={
              fullscreen ? undefined : (
                <Flex justify="end">{formatJSONButton}</Flex>
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
    <>
      <style>{`
        .sparse-tabbed-fullscreen {
          position: fixed;
          inset: 0;
          z-index: 1050;
          background-color: var(--color-surface-solid);
          padding: 1rem;
          display: flex;
          flex-direction: column;
        }
      `}</style>
      <div className={clsx({ "sparse-tabbed-fullscreen": fullscreen })}>
        {fullscreen ? (
          <Flex align="center" gap="3" mb="2">
            {label ? <Box className="font-weight-bold">{label}</Box> : null}
            <Flex align="center" gap="1">
              <Text size="small" weight="medium" color="text-low">
                Sparse patch
              </Text>
              <Tooltip content={SPARSE_PATCH_HELP}>
                <span
                  style={{ display: "inline-flex", color: "var(--gray-11)" }}
                >
                  <PiInfo size={14} />
                </span>
              </Tooltip>
            </Flex>
          </Flex>
        ) : null}
        {tabs}
      </div>
    </>
  );
}
