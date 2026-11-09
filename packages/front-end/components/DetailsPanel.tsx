import { ReactNode, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  DiscussionInterface,
  DiscussionParentType,
} from "shared/types/discussion";
import DiscussionThread from "@/components/DiscussionThread";
import CollapsiblePanelLayout, {
  PANEL_WIDTH_PX,
  Props as CollapsiblePanelLayoutProps,
} from "@/components/CollapsiblePanelLayout";
import { NARROW_LAYOUT_BREAKPOINT_PX } from "@/components/Layout/constants";
import { revealsQuickEdit } from "@/components/Experiment/TabbedPage/QuickEditButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ScrollArea from "@/ui/ScrollArea";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import useApi from "@/hooks/useApi";
import useMediaQuery from "@/hooks/useMediaQuery";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const DETAILS_PANEL_TABS = ["details", "comments"] as const;
export type DetailsPanelTab = (typeof DETAILS_PANEL_TABS)[number];

const TAB_FILLS_RAIL = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
} as const;

// Whether a page's details panel shows, how wide, and on which of its tabs. On
// the page's home tab the open state is remembered; off it the panel starts
// closed, and opening it there lasts until the tab changes. When narrow, it
// opens only on request, over the content; the stored choice is for a wide
// window, so narrowing never overwrites it.
export function useDetailsPanel({
  openKey,
  widthKey,
  tab,
  homeTab,
}: {
  openKey: string;
  widthKey: string;
  tab: string;
  homeTab: string;
}) {
  const [storedOpen, setStoredOpen] = useLocalStorage(openKey, true);
  const [width, setWidth] = useLocalStorage(widthKey, PANEL_WIDTH_PX);
  const narrow = useMediaQuery(`(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`);
  const [openWhileNarrow, setOpenWhileNarrow] = useState(false);
  useEffect(() => setOpenWhileNarrow(false), [narrow]);
  const [openOffHome, setOpenOffHome] = useState(false);
  useEffect(() => setOpenOffHome(false), [tab]);
  const [open, setOpen]: [boolean, (open: boolean) => void] = narrow
    ? [openWhileNarrow, setOpenWhileNarrow]
    : tab === homeTab
      ? [storedOpen, setStoredOpen]
      : [openOffHome, setOpenOffHome];
  // Held here because the panel unmounts whenever it closes.
  const [panelTab, setPanelTab] = useState<DetailsPanelTab>("details");

  return {
    open,
    setOpen,
    // The toggle is a fresh start: a width dragged out earlier is forgotten.
    toggle: (next: boolean) => {
      setWidth(PANEL_WIDTH_PX);
      setOpen(next);
    },
    width,
    setWidth,
    panelTab,
    setPanelTab,
  };
}

// The page's content, under its tab bar, beside its details panel; a null
// panel leaves the content alone.
export function DetailsPanelLayout({
  details,
  stickyTop,
  panel,
  footer,
  busy,
  className,
  children,
}: {
  details: ReturnType<typeof useDetailsPanel>;
  // Where the panel sticks: under the page's tabs and whatever they carry.
  stickyTop?: number;
  // For the page's own layout rules (global.scss).
  className?: string;
} & Pick<
  CollapsiblePanelLayoutProps,
  "panel" | "footer" | "busy" | "children"
>) {
  return (
    <Box
      mx="auto"
      width="100%"
      className={className}
      style={{ maxWidth: "var(--page-content-max-width)" }}
    >
      <CollapsiblePanelLayout
        open={!!panel && details.open}
        top={stickyTop === undefined ? "var(--tabs-bottom)" : `${stickyTop}px`}
        width={details.width}
        onWidthChange={details.setWidth}
        onCollapse={() => details.setOpen(false)}
        panel={panel}
        footer={footer}
        busy={busy}
      >
        {children}
      </CollapsiblePanelLayout>
    </Box>
  );
}

// A page's right rail: its details, and its comment thread.
export default function DetailsPanel({
  tab,
  setTab,
  discussion,
  children,
}: {
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
  discussion: {
    type: DiscussionParentType;
    id: string;
    projects: string[];
    allowNewComments: boolean;
  };
  children: ReactNode;
}) {
  // The thread's own request, so a new comment updates the count too.
  const { data: discussionData } = useApi<{
    discussion: DiscussionInterface;
  }>(`/discussion/${discussion.type}/${discussion.id}`);
  const commentCount = discussionData?.discussion?.comments?.length ?? 0;

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = DETAILS_PANEL_TABS.find((t) => t === value);
        if (next) setTab(next);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Above the scroll area, so it and the scrollbar start under it. */}
      <Flex
        px="5"
        pt="2"
        align="center"
        gap="2"
        flexShrink="0"
        // The tab row's underline, run the rail's full width.
        style={{ boxShadow: "inset 0 -1px 0 0 var(--gray-a5)" }}
      >
        {/* Its labels line up with the rail's content below. */}
        <TabsList
          size="sm"
          alignText
          style={{ flex: 1, minWidth: 0, boxShadow: "none" }}
        >
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="comments">
            Comments
            {commentCount > 0 && (
              <Badge
                label={commentCount.toString()}
                size="xs"
                color="gray"
                variant="soft"
                radius="full"
                ml="1"
              />
            )}
          </TabsTrigger>
        </TabsList>
      </Flex>
      {/* Each held to the rail's height. The comments scroll on their own,
          outside any scroll area, so their composer can stick to the window. */}
      <TabsContent value="details" style={TAB_FILLS_RAIL}>
        <ScrollArea
          fill
          fillMinHeight="300px"
          style={{ flex: 1, minHeight: 0 }}
        >
          <Flex px="5" pt="4" pb="8" direction="column" gap="4">
            {children}
          </Flex>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="comments" style={TAB_FILLS_RAIL}>
        <DiscussionThread
          compact
          fillHeight
          type={discussion.type}
          id={discussion.id}
          allowNewComments={discussion.allowNewComments}
          projects={discussion.projects}
        />
      </TabsContent>
    </Tabs>
  );
}

export function PanelSection({
  title,
  badge = null,
  action = null,
  children,
}: {
  title: string;
  // Beside the title, in its own case.
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Box className={action ? revealsQuickEdit : undefined}>
      <CollapseTrigger open={open} onOpenChange={setOpen} action={action}>
        <Flex align="center" gap="2">
          <Text
            size="sm"
            weight="medium"
            color="text-low"
            textTransform="uppercase"
          >
            {title}
          </Text>
          {badge}
        </Flex>
      </CollapseTrigger>
      <Collapse open={open}>
        <Flex pt="4" direction="column" gap="3">
          {children}
        </Flex>
      </Collapse>
    </Box>
  );
}
