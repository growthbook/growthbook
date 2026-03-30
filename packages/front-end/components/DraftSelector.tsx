import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Collapsible from "react-collapsible";
import { PiCaretRightBold } from "react-icons/pi";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import RadioGroup from "@/ui/RadioGroup";

export type DraftMode = "existing" | "new" | "publish";

/**
 * Generic collapsible draft-selector shell shared between features and saved
 * groups. Callers supply the revision dropdown (rendered in the "existing
 * draft" disclosure) and the trigger label text for the "existing" option;
 * this component owns the Collapsible wrapper, trigger bar, and RadioGroup.
 */
export default function DraftSelector({
  hasActiveDrafts,
  mode,
  setMode,
  canAutoPublish,
  approvalRequired,
  defaultExpanded = false,
  triggerPrefix = "Changes will be",
  existingDraftLabel,
  revisionDropdown,
}: {
  hasActiveDrafts: boolean;
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  canAutoPublish: boolean;
  approvalRequired: boolean;
  defaultExpanded?: boolean;
  triggerPrefix?: string;
  /** Label shown in the collapsed trigger when mode === "existing" and a draft
   *  is selected. When null/undefined the fallback "a new draft" copy is used. */
  existingDraftLabel?: ReactNode;
  /** Content rendered inside the "Add to existing draft" disclosure. */
  revisionDropdown?: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultExpanded ?? false);

  const triggerLabel =
    mode === "publish" ? (
      <>
        {" "}
        <Text weight="semibold" as="span">
          published immediately
        </Text>
      </>
    ) : mode === "existing" && existingDraftLabel != null ? (
      <>
        {" added to draft: "}
        <Text weight="semibold" as="span">
          {existingDraftLabel}
        </Text>
      </>
    ) : (
      <>
        {" added to "}
        <Text weight="semibold" as="span">
          a new draft
        </Text>
      </>
    );

  const existingDraftDisclosure = revisionDropdown ? (
    <Flex
      direction="column"
      gap="2"
      pl="5"
      pb="1"
      mb="2"
      style={{ width: "100%" }}
    >
      {revisionDropdown}
    </Flex>
  ) : null;

  const options = [
    ...(hasActiveDrafts
      ? [
          {
            value: "existing",
            label: "Add to existing draft",
            renderOnSelect: existingDraftDisclosure ?? undefined,
            renderOutsideItem: true,
          },
        ]
      : []),
    { value: "new", label: "Create a new draft" },
    ...(canAutoPublish
      ? [
          {
            value: "publish",
            label: approvalRequired ? (
              <span style={{ color: "var(--red-11)" }}>
                Bypass approvals and publish now
              </span>
            ) : (
              "Publish now"
            ),
          },
        ]
      : []),
  ];

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      px="3"
      py="4"
      style={{ cursor: "pointer", userSelect: "none" }}
      className="draft-selector-collapsible-trigger"
    >
      <Box style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <HelperText status="info">
          <div
            className="ml-1"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {triggerPrefix}
            {triggerLabel}
          </div>
        </HelperText>
      </Box>
      <Button
        variant="ghost"
        size="xs"
        onClick={async (e) => {
          e?.stopPropagation();
          setIsOpen((v) => !v);
        }}
        style={{ marginLeft: -5 }}
      >
        <Flex align="center" gap="1">
          {!isOpen && <span style={{ marginRight: 4 }}>edit</span>}
          <PiCaretRightBold
            className="chevron-right"
            size={14}
            style={{ margin: "0 -4px" }}
          />
        </Flex>
      </Button>
    </Flex>
  );

  return (
    <Box mb="5" style={{ overflow: "hidden", borderRadius: "var(--radius-4)" }}>
      <Collapsible
        trigger={trigger}
        transitionTime={75}
        contentInnerClassName="draft-selector-collapsible-content"
        open={isOpen}
        handleTriggerClick={() => setIsOpen((v) => !v)}
      >
        <Box px="3" py="3" style={{ backgroundColor: "var(--violet-a3)" }}>
          <RadioGroup
            options={options}
            value={mode}
            setValue={(v) => setMode(v as DraftMode)}
            width="100%"
          />
        </Box>
      </Collapsible>
    </Box>
  );
}
