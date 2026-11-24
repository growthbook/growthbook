import { ComponentProps, CSSProperties, ReactNode } from "react";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import { REVIEW_REQUESTED_STATUSES } from "shared/validators";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import { DropdownMenu, MoreMenuTrigger } from "@/ui/DropdownMenu";
import { Tabs, TabsList } from "@/ui/Tabs";
import { PageBleed } from "@/components/Layout/PageFrame";
import {
  DetailsPanelToggle,
  PANEL_WIDTH_PX,
} from "@/components/CollapsiblePanelLayout";
import { draftStatusTooltip } from "@/components/Reviews/RevisionStatusBadge";
import usePinnedHeader from "@/hooks/usePinnedHeader";
import QuickEditButton, {
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";

// The header and tab row of a page built on the details panel.

// From the details panel's default edge to where the cards' content ends: the
// page padding at desktop widths, a card's padding and border (57px).
export const REVISION_SELECTOR_WIDTH_PX = PANEL_WIDTH_PX - 57;

// Beside the title, centred on its line.
const titleInline: CSSProperties = {
  verticalAlign: "top",
  height: "var(--heading-line-height-7)",
  lineHeight: 0,
};

// White over the page's violet, which only the content column below shows,
// from the side nav to the window, its content on the page's edges.
export function DetailsPageTitleBar({
  title,
  onRename = null,
  renameBlockedReason = null,
  badges,
  actions,
  children,
}: {
  title: ReactNode;
  // The title's hover pencil, as the experiment page's; none without one.
  onRename?: (() => void) | null;
  renameBlockedReason?: string | null;
  // Beside the title.
  badges?: ReactNode;
  actions?: ReactNode;
  // Under the title row, e.g. an archived notice.
  children?: ReactNode;
}) {
  return (
    <PageBleed
      style={{
        position: "relative",
        background: "var(--color-panel-solid)",
        // From the app header down: it holds the page's top padding itself.
        marginTop: "calc(-1 * var(--page-top-padding))",
        paddingTop: "var(--page-top-padding)",
        paddingBottom: "var(--space-2)",
      }}
    >
      <Flex direction="row" align="start" justify="between" gap="5">
        {/* Raised so the name's x-height centres on the buttons' text. */}
        <Flex
          align="center"
          gap="3"
          mt="-3px"
          className={onRename ? revealsQuickEdit : undefined}
        >
          <Heading
            as="h1"
            size="2xl"
            color="text-high"
            overflowWrap="anywhere"
            weight="medium"
            mb="0"
          >
            {title}
            {/* Inline and centred on the name's last line. The word joiner
                keeps the pencil on that line. */}
            {onRename ? (
              <>
                {"\u2060"}
                <Flex
                  as="span"
                  display="inline-flex"
                  align="center"
                  style={titleInline}
                >
                  <QuickEditButton
                    label="Edit name"
                    onClick={onRename}
                    blockedReason={renameBlockedReason}
                  />
                </Flex>
              </>
            ) : null}
          </Heading>
          {badges}
        </Flex>
        {actions}
      </Flex>
      {children}
    </PageBleed>
  );
}

// The title row's buttons: a new-draft button, then the page's menu.
export function DetailsPageActions({
  newDraft,
  menu,
}: {
  newDraft?: ReactNode;
  menu?: ReactNode;
}) {
  return (
    <Flex align="center" gap="4" height="var(--space-6)">
      {newDraft ? (
        // Ends over the revision picker: into the menu button's gap, then
        // back by a border as wide as a card's, which zoom rounds the same way.
        <Box style={{ marginRight: -9, borderRight: "1px solid transparent" }}>
          {newDraft}
        </Box>
      ) : null}
      {menu}
    </Flex>
  );
}

export function DetailsPageMenu({
  open,
  onOpenChange,
  disabledReason = null,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Why the menu is unavailable, shown on its disabled button.
  disabledReason?: string | null;
  children: ReactNode;
}) {
  const disabled = !!disabledReason;
  const menu = (
    <DropdownMenu
      trigger={
        <MoreMenuTrigger
          label="More actions"
          size="lg"
          disabled={disabled}
          // Above the details toggle, past the row's end. Inline, not
          // margin props: a ghost button adds its own offset to those.
          style={{ marginLeft: 0, marginRight: -16 }}
        />
      }
      open={open && !disabled}
      onOpenChange={onOpenChange}
      menuPlacement="end"
      disabled={disabled}
    >
      {children}
    </DropdownMenu>
  );
  return disabled ? (
    <Tooltip content={disabledReason}>
      <span>{menu}</span>
    </Tooltip>
  ) : (
    menu
  );
}

// A tab's count, as a circle beside its name: gray for how many there are,
// red for what needs attention.
export function TabCount({
  count,
  attention = false,
}: {
  count: number;
  attention?: boolean;
}) {
  if (!count) return null;
  return (
    <Badge
      label={String(count)}
      color={attention ? "red" : "gray"}
      variant={attention ? "solid" : "soft"}
      radius="full"
      ml="2"
      style={{ minWidth: 18, height: 18 }}
    />
  );
}

// The Review tab's count of revisions waiting on reviewers or publishers;
// drafts still being edited don't need their attention.
export function ReviewTabCount({ statuses }: { statuses: string[] }) {
  const counts: Partial<Record<string, number>> = {};
  statuses.forEach((status) => {
    if ((REVIEW_REQUESTED_STATUSES as readonly string[]).includes(status)) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
  });
  const total = Object.values(counts).reduce<number>(
    (sum, n) => sum + (n ?? 0),
    0,
  );
  if (!total) return null;
  return (
    <Tooltip content={draftStatusTooltip(counts)}>
      <span>
        <TabCount count={total} attention />
      </span>
    </Tooltip>
  );
}

export function DetailsPageTabs({
  value,
  onValueChange,
  triggers,
  revisionPicker,
  detailsOpen,
  setDetailsOpen,
  leftPanel = null,
  statusBar,
}: {
  value: string;
  onValueChange: (value: string) => void;
  triggers: ReactNode;
  revisionPicker?: ReactNode;
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  // A left panel's name and toggle, before the tabs.
  leftPanel?: Pick<
    ComponentProps<typeof DetailsPanelToggle>,
    "name" | "open" | "setOpen"
  > | null;
  // The viewed revision's state, fixed under the tabs.
  statusBar?: ReactNode;
}) {
  const [sentinelRef, pinned] = usePinnedHeader();
  return (
    <>
      <div
        ref={sentinelRef}
        aria-hidden
        className="d-print-none"
        style={{
          height: 1,
          width: "100%",
          pointerEvents: "none",
          background: "var(--color-panel-solid)",
        }}
      />
      <PageBleed className={clsx("details-tabs d-print-none", { pinned })}>
        <Box position="relative">
          <Flex align="center" className="header-tabs">
            {leftPanel ? (
              <DetailsPanelToggle side="left" {...leftPanel} />
            ) : null}
            <Tabs
              value={value}
              onValueChange={onValueChange}
              style={{ flex: 1, minWidth: 0 }}
            >
              <TabsList size="lg" style={{ width: "100%" }}>
                {triggers}
              </TabsList>
            </Tabs>
            {/* Beside the tab list, not in it: the list folds tabs that
                don't fit into its More menu. Ends where the cards' content
                does below: into the toggle's margin, then back by a border
                as wide as a card's, which zoom rounds the same way. */}
            {revisionPicker ? (
              <Box
                flexShrink="0"
                ml="4"
                mr="-3"
                style={{ borderRight: "1px solid transparent" }}
              >
                {revisionPicker}
              </Box>
            ) : null}
            <DetailsPanelToggle open={detailsOpen} setOpen={setDetailsOpen} />
          </Flex>
        </Box>
        {statusBar}
      </PageBleed>
    </>
  );
}
