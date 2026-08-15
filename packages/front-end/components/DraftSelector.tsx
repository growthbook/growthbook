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
  metadataOnly = false,
  singleOption = false,
  canDraft = true,
  newDraftDisabled = false,
  newDraftDisabledReason,
  recommendExisting = false,
  alert,
  alertActive = true,
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
  /**
   * When true the selector renders the "always create a revision" flow used
   * for metadata-only edits when an entity-type's metadata-review gate is
   * off: the publish-now option is hidden (the publish step happens later
   * from the entity's page) and the radio uses "revision" terminology so it
   * lines up with the page-level controls.
   */
  metadataOnly?: boolean;
  /** When true (only one mode is available) the edit CTA and expand behaviour
   *  are suppressed entirely. The caller is responsible for ensuring `mode` is
   *  already set to the correct value. */
  singleOption?: boolean;
  /** Whether the user may author drafts at all. Without it the draft options are
   *  not offered — publishing is the only way their change can land. */
  canDraft?: boolean;
  /** Disable the "create a new draft" option — e.g. the org's soft draft cap is
   *  reached and the caller may not exceed it. */
  newDraftDisabled?: boolean;
  newDraftDisabledReason?: ReactNode;
  /** Flag "add to existing draft" as the recommended choice (soft cap reached). */
  recommendExisting?: boolean;
  /** Single-line warning shown in the trigger. */
  alert?: ReactNode;
  /** Whether that warning still applies to the selected target. When false the
   *  control keeps its normal styling and only the warning line reads amber. */
  alertActive?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultExpanded ?? false);

  const hasAlert = !!alert;
  // Recolor only while the warning applies to the chosen target.
  const showsConflict = hasAlert && alertActive;

  const newOptionLabel = metadataOnly
    ? "Add to a new revision"
    : "Create a new draft";
  const existingOptionLabel = metadataOnly
    ? "Add to existing revision"
    : "Add to existing draft";
  const triggerNewCopy = metadataOnly ? "a new revision" : "a new draft";
  const triggerExistingCopy = metadataOnly
    ? "added to revision: "
    : "added to draft: ";

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
        {` ${triggerExistingCopy}`}
        <Text weight="semibold" as="span">
          {existingDraftLabel}
        </Text>
      </>
    ) : (
      <>
        {" added to "}
        <Text weight="semibold" as="span">
          {triggerNewCopy}
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
    ...(hasActiveDrafts && canDraft
      ? [
          {
            value: "existing",
            label: recommendExisting ? (
              <>
                {existingOptionLabel}{" "}
                <span style={{ color: "var(--violet-11)" }}>(Recommended)</span>
              </>
            ) : (
              existingOptionLabel
            ),
            renderOnSelect: existingDraftDisclosure ?? undefined,
            renderOutsideItem: true,
          },
        ]
      : []),
    ...(canDraft
      ? [
          {
            value: "new",
            label: newOptionLabel,
            disabled: newDraftDisabled,
            disabledReason: newDraftDisabled
              ? newDraftDisabledReason
              : undefined,
          },
        ]
      : []),
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
      align={hasAlert ? "start" : "center"}
      justify="between"
      gap="3"
      px="3"
      py={hasAlert ? "3" : "4"}
      style={{
        cursor: singleOption ? "default" : "pointer",
        userSelect: "none",
      }}
      className={`draft-selector-collapsible-trigger${singleOption ? " no-hover" : ""}${showsConflict ? " has-conflict" : ""}`}
    >
      <Box style={{ flex: 1, minWidth: 0 }}>
        <HelperText status={showsConflict ? "warning" : "info"}>
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
        {alert && (
          <Box mt="1" className="ml-1">
            {alert}
          </Box>
        )}
      </Box>
      {!singleOption && (
        <Button
          variant="ghost"
          size="sm"
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
      )}
    </Flex>
  );

  return (
    <Box mb="5" style={{ overflow: "hidden", borderRadius: "var(--radius-4)" }}>
      <Collapsible
        trigger={trigger}
        transitionTime={75}
        contentInnerClassName="draft-selector-collapsible-content"
        open={isOpen}
        handleTriggerClick={() => {
          if (!singleOption) setIsOpen((v) => !v);
        }}
      >
        <Box
          px="3"
          py="3"
          style={{
            backgroundColor: showsConflict
              ? "var(--amber-a3)"
              : "var(--violet-a3)",
          }}
        >
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
