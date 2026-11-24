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
import styles from "./DetailsPanel.module.scss";

const DETAILS_PANEL_TABS = ["details", "comments"] as const;
export type DetailsPanelTab = (typeof DETAILS_PANEL_TABS)[number];

const TAB_FILLS_RAIL = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
} as const;

// Whether a page's details panel shows, how wide, and on which of its tabs. On
// the page's home tabs the open state is remembered; off them the panel starts
// closed, and opening it there lasts until the tab changes. When it would float
// over the content (a narrow window, or a left panel taking the room), it opens
// only on request; the stored choice is for when it docks, so floating never
// overwrites it.
export function useDetailsPanel({
  openKey,
  widthKey,
  tab,
  homeTab,
  defaultWidth = PANEL_WIDTH_PX,
}: {
  openKey: string;
  widthKey: string;
  tab: string;
  homeTab: string | string[];
  defaultWidth?: number;
}) {
  const [storedOpen, setStoredOpen] = useLocalStorage(openKey, true);
  const [width, setWidth] = useLocalStorage(widthKey, defaultWidth);
  const narrow = useMediaQuery(`(max-width: ${NARROW_LAYOUT_BREAKPOINT_PX}px)`);
  // Reported by the layout, which knows the room beside the panel.
  const [floating, setFloating] = useState(false);
  const onRequest = narrow || floating;
  const [openOnRequest, setOpenOnRequest] = useState(false);
  useEffect(() => setOpenOnRequest(false), [onRequest, tab]);
  const [openOffHome, setOpenOffHome] = useState(false);
  useEffect(() => setOpenOffHome(false), [tab]);
  const [open, setOpen]: [boolean, (open: boolean) => void] = onRequest
    ? [openOnRequest, setOpenOnRequest]
    : [homeTab].flat().includes(tab)
      ? [storedOpen, setStoredOpen]
      : [openOffHome, setOpenOffHome];
  // Held here because the panel unmounts whenever it closes.
  const [panelTab, setPanelTab] = useState<DetailsPanelTab>("details");

  return {
    open,
    setOpen,
    // The toggle is a fresh start: a width dragged out earlier is forgotten.
    toggle: (next: boolean) => {
      setWidth(defaultWidth);
      setOpen(next);
    },
    width,
    setWidth,
    setFloating,
    panelTab,
    setPanelTab,
  };
}

// The page's content, under its tab bar, beside its details panel; a null
// panel leaves the content alone. A page may keep a second panel on the left.
export function DetailsPanelLayout({
  details,
  stickyTop,
  panel,
  footer,
  busy,
  leftPanel,
  minContentWidth,
  children,
}: {
  details: ReturnType<typeof useDetailsPanel>;
  // Where the panels stick: under the page's tabs and whatever they carry.
  stickyTop?: number;
  leftPanel?: {
    details: ReturnType<typeof useDetailsPanel>;
    panel: ReactNode;
  };
} & Pick<
  CollapsiblePanelLayoutProps,
  "panel" | "footer" | "busy" | "minContentWidth" | "children"
>) {
  const top = stickyTop === undefined ? "var(--tabs-bottom)" : `${stickyTop}px`;
  const content = (
    <CollapsiblePanelLayout
      open={!!panel && details.open}
      top={top}
      width={details.width}
      onWidthChange={details.setWidth}
      onCollapse={() => details.setOpen(false)}
      onFloatChange={details.setFloating}
      minContentWidth={minContentWidth}
      panel={panel}
      footer={footer}
      busy={busy}
    >
      <div className={styles.column}>{children}</div>
    </CollapsiblePanelLayout>
  );
  return (
    <div className={styles.layout}>
      {/* A page has a left panel or doesn't, so this never remounts it. */}
      {leftPanel ? (
        <CollapsiblePanelLayout
          side="left"
          open={leftPanel.details.open}
          top={top}
          width={leftPanel.details.width}
          onWidthChange={leftPanel.details.setWidth}
          onCollapse={() => leftPanel.details.setOpen(false)}
          panel={leftPanel.panel}
        >
          {content}
        </CollapsiblePanelLayout>
      ) : (
        content
      )}
    </div>
  );
}

// The details, scrolling within the rail.
function DetailsScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollArea fill fillMinHeight="300px" style={{ flex: 1, minHeight: 0 }}>
      <Flex px="5" pt="4" pb="8" direction="column" gap="4">
        {children}
      </Flex>
    </ScrollArea>
  );
}

type Discussion = {
  type: DiscussionParentType;
  id: string;
  projects: string[];
  allowNewComments: boolean;
};

// A page's right rail: its details, and its comment thread if it has one.
export default function DetailsPanel(
  props:
    | { children: ReactNode }
    | {
        tab: DetailsPanelTab;
        setTab: (tab: DetailsPanelTab) => void;
        discussion: Discussion;
        children: ReactNode;
      },
) {
  if ("discussion" in props) return <DetailsWithDiscussion {...props} />;
  return (
    <Flex direction="column" flexGrow="1" minHeight="0">
      <DetailsScroll>{props.children}</DetailsScroll>
    </Flex>
  );
}

function DetailsWithDiscussion({
  tab,
  setTab,
  discussion,
  children,
}: {
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
  discussion: Discussion;
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
        <DetailsScroll>{children}</DetailsScroll>
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
