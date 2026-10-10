import React, {
  CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/router";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiDownloadSimpleBold,
  PiArrowsInLineVerticalBold,
  PiArrowsOutLineVerticalBold,
  PiMagnifyingGlassBold,
  PiTextColumnsBold,
  PiXBold,
  PiPlusBold,
} from "react-icons/pi";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import Heading from "@/ui/Heading";
import TextField from "@/ui/TextField";
import Link from "@/ui/Link";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import ImportExperimentModal from "@/components/Experiment/ImportExperimentModal";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import LinkButton from "@/ui/LinkButton";
import CreateExperimentModal from "@/components/Experiment/CreateExperimentModal";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import ViewSampleDataButton from "@/components/GetStarted/ViewSampleDataButton";
import EmptyState from "@/components/EmptyState";
import Callout from "@/ui/Callout";
import { useExperimentSearch } from "@/services/experiments";
import { useWatching } from "@/services/WatchProvider";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import UiTooltip from "@/ui/Tooltip";
import headerStyles from "@/components/Experiment/TabbedPage/ExperimentHeader.module.scss";
import ExperimentsListTable, {
  experimentsListColumnDefs,
} from "@/components/Experiment/ExperimentsListTable";
import ColumnSettingsButton from "@/ui/ColumnSettingsButton";
import { useTableColumns } from "@/hooks/useTableColumns";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import useURLHash from "@/hooks/useURLHash";

const EXPERIMENT_LIST_TABS = [
  "all",
  "running",
  "drafts",
  "stopped",
  "archived",
] as const;
type ExperimentListTab = (typeof EXPERIMENT_LIST_TABS)[number];
const isExperimentListTab = (value: string): value is ExperimentListTab => {
  return EXPERIMENT_LIST_TABS.includes(value as ExperimentListTab);
};

const ExperimentsPage = (): React.ReactElement => {
  const { ready, project, projects, datasources } = useDefinitions();
  const { organization } = useUser();
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || "",
  );
  const hasNonDemoDatasource = datasources.some(
    (d) => !d.projects?.includes(demoProjectId),
  );

  // The search field, so clearing it puts the cursor back in it.
  const searchFieldRef = useRef<HTMLInputElement>(null);
  const initialHashRef = useRef(
    globalThis?.window ? window.location.hash.slice(1) : "",
  );
  const hasInitialValidHash = isExperimentListTab(initialHashRef.current);
  const [urlTab, setTab] = useURLHash<ExperimentListTab>(EXPERIMENT_LIST_TABS);
  const tab: ExperimentListTab =
    urlTab && isExperimentListTab(urlTab) ? urlTab : "all";
  const [storedTab, setStoredTab] = useLocalStorage<ExperimentListTab>(
    "experiments-list-tab",
    "all",
  );
  const [didInitializeTab, setDidInitializeTab] = useState(false);
  const activeTab: ExperimentListTab =
    !hasInitialValidHash && !didInitializeTab ? storedTab : tab;

  // Which way the last tab switch went, in the tab bar's order, so the new
  // tab's table drifts in from that side (set in review; see the
  // .rt-TabsContent rule below). Null until a switch the user made: the
  // tab can change once while it initializes, and that shouldn't animate.
  // Updated during render, React's pattern for state that follows a value,
  // so it's set before the new table paints; cleared when the animation
  // ends, taking its overflow clip with it.
  const [prevListTab, setPrevListTab] = useState(activeTab);
  const [listTabDirection, setListTabDirection] = useState<
    "forward" | "back" | null
  >(null);
  if (activeTab !== prevListTab) {
    setPrevListTab(activeTab);
    if (didInitializeTab) {
      setListTabDirection(
        EXPERIMENT_LIST_TABS.indexOf(activeTab) >
          EXPERIMENT_LIST_TABS.indexOf(prevListTab)
          ? "forward"
          : "back",
      );
    }
  }

  useEffect(() => {
    if (didInitializeTab) return;

    // If no valid hash is provided, initialize from localStorage once.
    if (!hasInitialValidHash && storedTab !== tab) {
      setTab(storedTab);
    }

    setDidInitializeTab(true);
  }, [didInitializeTab, setTab, storedTab, tab]);

  useEffect(() => {
    if (!didInitializeTab) return;
    if (storedTab !== tab) {
      setStoredTab(tab);
    }
  }, [didInitializeTab, setStoredTab, storedTab, tab]);

  const analyzeExisting = useRouter().query?.analyzeExisting === "true";

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
    tempRolloutExperimentIds,
  } = useExperiments(project, activeTab === "archived", "standard", {
    includeTempRollouts: true,
  });
  const { watchedExperiments } = useWatching();

  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);
  const [openImportExperimentModal, setOpenImportExperimentModal] =
    useState(false);

  const permissionsUtil = usePermissionsUtil();

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    syntaxFilters,
    setSearchValue,
  } = useExperimentSearch({
    allExperiments,
    watchedExperimentIds: watchedExperiments,
    tempRolloutExperimentIds,
    localStorageKey: "experiments-page",
    // One arrow on the sorted column, the others on hover (set in review).
    sortIcons: "arrow",
  });

  // The table's columns, held here so the toolbar's column settings and
  // both tables share them (set in review): order, visibility and widths,
  // saved in this browser. Built with the same options the tables get.
  const listColumnDefs = useMemo(
    () =>
      experimentsListColumnDefs({
        statusFirst: true,
        hiddenColumns: ["owner", "date", "result"],
        showWatchColumn: false,
      }),
    [],
  );
  const listColumns = useTableColumns({
    storageKey: "experiments-page",
    columns: listColumnDefs,
  });
  // Compact rows (36px) or comfortable (52px), from the toolbar's density
  // button; saved in this browser (set in review).
  const [compactRows, setCompactRows] = useLocalStorage<boolean>(
    "experiments-page:compact-rows",
    false,
  );

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.tab] = (counts[item.tab] || 0) + 1;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return activeTab !== "all"
      ? items.filter((item) => item.tab === activeTab)
      : items;
  }, [activeTab, items]);

  if (error) {
    return <Callout status="error">An error occurred: {error.message}</Callout>;
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = allExperiments.length > 0;

  // Inactive tabs in regular weight, as on the experiment details page.
  // "normal" is 400; React's style type doesn't accept a var() here.
  const tabWeight = (value: string): CSSProperties | undefined =>
    activeTab !== value ? { fontWeight: "normal" } : undefined;

  // Only surface the sample CTA when the user has no experiments yet.
  const showViewSampleButton = !hasExperiments;

  const canAddExperiment = permissionsUtil.canViewExperimentModal(
    project,
    projects,
  );

  // Import (secondary) and Create (primary), side by side (set in review),
  // in place of the Add menu. Import is the experiment details page's outline
  // header button: the --slate-6 outline that darkens on hover.
  const importDisabled = !canAddExperiment || !hasNonDemoDatasource;
  const addExperimentButtons = (
    <>
      <UiTooltip
        content="Connect a data source to import existing experiments."
        enabled={canAddExperiment && !hasNonDemoDatasource}
      >
        {/* A span, so the tooltip still shows on the disabled button. */}
        <span>
          <Button
            variant="outline"
            color="gray"
            // The custom outline and text colour only while enabled: they'd
            // override Radix's disabled look (greyed text, lighter outline).
            className={importDisabled ? undefined : headerStyles.outlineButton}
            style={importDisabled ? undefined : { color: "var(--slate-12)" }}
            icon={<PiDownloadSimpleBold />}
            onClick={() => setOpenImportExperimentModal(true)}
            disabled={importDisabled}
          >
            Import
          </Button>
        </span>
      </UiTooltip>
      <Button
        icon={<PiPlusBold />}
        onClick={() => setOpenNewExperimentModal(true)}
        disabled={!canAddExperiment}
      >
        Create
      </Button>
    </>
  );

  return (
    <>
      {/* Page-wide overrides, as on the redesigned experiment details page
        (set in review; see TabbedPage/index.tsx). White page background: the
        app's page-background token is repointed to --color-panel-solid, white
        in light mode and the dark panel colour in dark mode, so everything
        that matches the page turns white with it. The tripled class beats
        radix-config.css's `.light-theme .radix-themes` regardless of load
        order. Mounted with this page only, so other pages are unchanged. */}
      <style jsx global>{`
        .radix-themes.radix-themes.radix-themes {
          --color-background: var(--color-panel-solid);
        }
        /* The top bar's breadcrumb lines up with the page's 32px left edge,
          as on the experiment details page (set in review). Above 520px
          only: below that the top bar drops to 8px for small screens, and
          that's left alone. */
        @media (min-width: 521px) {
          [data-topbar][data-topbar] {
            padding-left: var(--space-6);
          }
        }
        /* The search field's hover, as the experiment details page's fields
          (set in review; see SetupPage/_hoverOutline.scss): its outline
          eases to --slate-9 over 150ms when hovered, and back when the
          cursor leaves. Not while it's focused, which has its own focus
          outline. Instant for reduced motion. */
        .contents.experiments .rt-TextFieldRoot.rt-variant-surface {
          transition: box-shadow 150ms ease;
        }
        .contents.experiments
          .rt-TextFieldRoot.rt-variant-surface:hover:not(:focus-within) {
          box-shadow: inset 0 0 0 var(--text-field-border-width) var(--slate-9);
        }
        @media (prefers-reduced-motion: reduce) {
          .contents.experiments .rt-TextFieldRoot.rt-variant-surface {
            transition: none;
          }
        }
        /* Only the clear button above: the browser's own clear "×" on
          search fields is hidden, so there aren't two. */
        .contents.experiments
          .rt-TextFieldInput[type="search"]::-webkit-search-cancel-button {
          -webkit-appearance: none;
          appearance: none;
          display: none;
        }
        /* The search icon the same 8px from the field's edge as from the
          placeholder (set in review). Radix pads the icon's slot 8px on
          both sides but pulls it 1px left over the border, leaving 7px
          inside it; without the pull it's 8px, matching the 8px to the
          text (the input has no left padding beside a slot). */
        .contents.experiments
          .rt-TextFieldRoot
          .rt-TextFieldSlot:not([data-side="right"]) {
          margin-left: 0;
          padding-left: var(--space-2);
          padding-right: var(--space-2);
        }
        /* The clear button's "×" likewise 8px from the field's right edge
          (set in review), mirroring the search icon. The ghost icon button
          takes only the icon's own width (its 4px padding is offset by
          negative margins), so without Radix's 1px pull over the border the
          slot's 8px puts the "×" 8px in. */
        .contents.experiments
          .rt-TextFieldRoot
          .rt-TextFieldSlot[data-side="right"] {
          margin-right: 0;
          padding-left: var(--space-2);
          padding-right: var(--space-2);
        }
        /* The table's column header row (set in review): no drop shadow at
          rest, only its top edge line, part of the table's outline; once it
          sticks under the top bar (Table sets data-sticky-active), a softer
          shadow than the list table's default (0 2px 4px -2px, was 0 4px 6px
          -2px), fading in. Off for reduced motion. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableHeader {
          box-shadow: inset 0 1px 0 0 var(--slate-a5);
          transition: box-shadow 150ms ease;
          /* No background of its own (set in review; tried --slate-2 grey,
            without the divider): the page's colour, --color-panel-solid,
            also as the table's row colour, which its cells take. Not
            transparent: the header sticks while scrolling, and rows would
            show through. */
          --table-row-background-color: var(--color-panel-solid);
          background-color: var(--color-panel-solid);
        }
        .contents.experiments
          [data-table-list][data-table-list][data-sticky-active="true"]
          .rt-TableHeader {
          box-shadow:
            inset 0 1px 0 0 var(--slate-a5),
            0 2px 4px -2px var(--black-a2);
        }
        @media (prefers-reduced-motion: reduce) {
          .contents.experiments
            [data-table-list][data-table-list]
            .rt-TableHeader {
            transition: none;
          }
        }
        /* One text colour for the column headers and the values (set in
          review): --gray-12, which the experiment name already uses, in
          place of the inherited --text-color-main. Badges, tags and other
          text with a colour of its own keep it. */
        .contents.experiments
          [data-table-list][data-table-list]
          :is(.rt-TableColumnHeaderCell, .rt-TableCell) {
          color: var(--gray-12);
        }
        /* The lines between rows lighter (set in review): --gray-a3 (tried
          a4), was Radix's --gray-a5. The line under the header matches (see
          the header cells below). Not the last row: it has no line of its
          own, and this mustn't add one. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableRow:not(:last-child) {
          --table-row-box-shadow: inset 0 -1px var(--gray-a3);
        }
        /* The row hover highlight fades instead of snapping (set in
          review): in over 150ms, so it still
          answers the pointer quickly, and out over a slower 250ms, so
          moving down the list leaves a soft trail rather than a flicker.
          Instant for reduced motion. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableRow
          .rt-TableCell {
          /* With the hover fade, the row density change (set in review):
            switching compact and comfortable eases each row's height and
            padding over 220ms rather than snapping. */
          transition:
            background-color 250ms ease-out,
            height 220ms cubic-bezier(0.22, 1, 0.36, 1),
            padding 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableRow:hover
          .rt-TableCell {
          /* The hover fade in quicker; the density change unchanged. */
          transition-duration: 150ms, 220ms, 220ms;
        }
        /* The experiment name's link fills its cell, so its padding eases
          with the rows. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableCell
          > a {
          transition: padding 220ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        /* The highlight in neutral --slate-2 (set in review; --slate-3 was
          too dark), in place of the list table's light violet --accent-a2.
          As specific as the list table's own rule plus one, so it wins; rows
          marked data-no-hover stay unhighlighted, as there. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableRow:not([data-no-hover]):hover
          .rt-TableCell {
          background-color: var(--slate-2);
        }
        @media (prefers-reduced-motion: reduce) {
          .contents.experiments
            [data-table-list][data-table-list]
            .rt-TableBody
            .rt-TableRow
            .rt-TableCell,
          .contents.experiments
            [data-table-list][data-table-list]
            .rt-TableBody
            .rt-TableCell
            > a {
            transition: none;
          }
        }
        /* 20px between the table's left and right edges and its first and
          last columns, in the header and every row (set in review; tried
          24px, were 12px). OFF THE SPACE SCALE (--space-4 is 16px,
          --space-5 24px), so raw, as the Setup rail's 20px padding. The
          Experiment column, first here, has no cell padding (its
          link fills the cell), so its link takes the inset through
          --experiments-name-padding-left (ExperimentsListTable.tsx). */
        .contents.experiments
          [data-table-list][data-table-list]
          :is(.rt-TableHeader, .rt-TableBody)
          :is(.rt-TableColumnHeaderCell, .rt-TableCell):first-child {
          padding-left: 20px;
          --experiments-name-padding-left: 20px;
        }
        .contents.experiments
          [data-table-list][data-table-list]
          :is(.rt-TableHeader, .rt-TableBody)
          :is(.rt-TableColumnHeaderCell, .rt-TableCell):last-child {
          padding-right: 20px;
        }
        /* One line per cell (set in review): nothing wraps; what doesn't
          fit its column ends in "…" (text) or is cut off at the column's
          edge (tags, badges). Needs the table's fixed column widths
          (fixedColumns). The cells' tooltips open in a portal, so the
          clipping doesn't hide them. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableCell {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Rows of items inside a cell (tags, the name and its icons) stay on
          one line too, and their text can shrink to its "…". */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableCell
          div {
          flex-wrap: nowrap;
          min-width: 0;
        }
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableCell
          :is(.testname, .testid) {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* Values outside the first (Experiment) column at 13px (set in
          review, trying it; were the table's 14px). OFF THE TYPE SCALE
          (--font-size-1 is 12px, --font-size-2 14px), so raw. The line
          height stays 20px, so rows keep their height. Tags and badges set
          their own sizes. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableCell:not(:first-child) {
          font-size: 13px;
        }
        /* The experiment names, the first column's values, at 500 (set in
          review), over global.scss's .experiments .testname at 400. Not the
          tracking key under a name. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .testname {
          font-weight: var(--font-weight-medium);
        }
        /* Each column header tints on hover (set in review), fading in and
          out, so it's clear which column a click sorts or a drag resizes:
          --slate-2, opaque, as the header sticks over the rows. Instant for
          reduced motion. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableHeader
          .rt-TableColumnHeaderCell {
          transition: background-color 150ms ease;
        }
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableHeader
          .rt-TableColumnHeaderCell:hover {
          background-color: var(--slate-2);
        }
        @media (prefers-reduced-motion: reduce) {
          .contents.experiments
            [data-table-list][data-table-list]
            .rt-TableHeader
            .rt-TableColumnHeaderCell {
            transition: none;
          }
        }
        /* The column resize handles (set in review): no line at rest; over
          a header cell's edge the cursor changes to col-resize and a solid
          1px line in --slate-8 fades in to mark the edge, between the
          cell's top and bottom lines, and fades out on leaving. Solid, not a translucent token
          (set in review). Shown too while dragging, and while a handle has
          keyboard focus (the handle draws no outline). In place of the
          shared handle's short 2px accent mark. Instant for reduced
          motion. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableColumnHeaderCell
          [role="separator"][aria-orientation="vertical"]::after {
          /* 1px in from the top and bottom, so it meets the table's top
            border and the line under the header without covering them (set
            in review). */
          top: 1px;
          bottom: 1px;
          height: auto;
          width: 1px;
          border-radius: 0;
          background-color: var(--slate-8);
          opacity: 0;
          transition: opacity 150ms ease;
        }
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableColumnHeaderCell
          [role="separator"][aria-orientation="vertical"]:is(
            :hover,
            :focus-visible,
            [data-active="true"]
          )::after {
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .contents.experiments
            [data-table-list][data-table-list]
            .rt-TableColumnHeaderCell
            [role="separator"][aria-orientation="vertical"]::after {
            transition: none;
          }
        }
        /* The table controls' button group (set in review): two square
          24px icon buttons, the design system's smallest (size 1; tried 32px
          and 28px), with 12px bold icons, in one outline, a 1px divider between, the same
          --slate-6 outline as the page's outline buttons, darkening to
          --slate-9 on hover over 150ms. Each button tints on hover.
          Instant for reduced motion. */
        .experiments-table-controls {
          height: 24px;
          border-radius: var(--radius-2);
          box-shadow: inset 0 0 0 1px var(--slate-6);
          overflow: hidden;
          transition: box-shadow 150ms ease;
        }
        .experiments-table-controls:hover {
          box-shadow: inset 0 0 0 1px var(--slate-9);
        }
        /* Square at the size's own height (size 1: 24px). Ghost icon
          buttons otherwise size by padding and negative margins, not by
          their height. */
        .experiments-table-controls .rt-IconButton {
          width: var(--base-button-height);
          height: var(--base-button-height);
          padding: 0;
          margin: 0;
          color: var(--slate-11);
        }
        .experiments-table-controls .rt-IconButton[aria-pressed="true"] {
          color: var(--slate-12);
          background-color: var(--slate-a3);
        }
        .experiments-table-controls-divider {
          align-self: stretch;
          width: 1px;
          background-color: var(--slate-6);
        }
        @media (prefers-reduced-motion: reduce) {
          .experiments-table-controls {
            transition: none;
          }
        }
        /* Compact rows (set in review; the density button): 36px (tried
          40px), 8px above and below the 20px line, in place of 52px and the
          table's 12px. The name link's padding follows, so it still fills
          the row. */
        .contents.experiments[data-compact-rows="true"]
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableCell {
          height: 36px;
          padding-top: var(--space-2);
          padding-bottom: var(--space-2);
          --experiments-name-padding-y: var(--space-2);
        }
        /* Switching tabs (set in review), as the experiment details page's
          tabs: the new tab's table fades in while drifting 8px from the side
          it's coming from, in the tab bar's order. Radix mounts only the
          active tab's content, so only the arrival is animated. Only after a
          switch (data-tab-direction, cleared when it ends); the sideways
          overflow is clipped while it moves (clip, not hidden, so the
          header still sticks). Instant for reduced motion. */
        .contents.experiments[data-tab-direction]
          .rt-TabsContent[data-state="active"] {
          animation: experiments-tab-in 260ms cubic-bezier(0.22, 1, 0.36, 1)
            both;
          overflow-x: clip;
        }
        .contents.experiments[data-tab-direction="back"]
          .rt-TabsContent[data-state="active"] {
          animation-name: experiments-tab-in-back;
        }
        @keyframes experiments-tab-in {
          from {
            opacity: 0;
            transform: translateX(8px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes experiments-tab-in-back {
          from {
            opacity: 0;
            transform: translateX(-8px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          /* No animation, so no animationend to clear the marker: no clip
            either. */
          .contents.experiments[data-tab-direction]
            .rt-TabsContent[data-state="active"] {
            animation: none;
            overflow-x: visible;
          }
        }
        /* The column headers likewise. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableHeader
          .rt-TableColumnHeaderCell {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Rows at least 52px tall (set in review; tried 48px, were the
          table's 44px). Body cells only: the header cells share the same
          minimum, and the header row stays shorter. Content is centred in
          the extra space; a row with a tracking key under the name grows to
          fit it. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableBody
          .rt-TableCell {
          height: 52px;
        }
        /* Column headers at 12px (set in review; were the table's 14px). The
          values stay 14px. Through .rt-TableHeader, so it outranks the list
          table's own header-cell padding (Table.module.scss), which would
          otherwise tie. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableHeader
          .rt-TableColumnHeaderCell {
          font-size: var(--font-size-1);
          line-height: var(--line-height-1);
          /* Softer than the values (set in review): --slate-11, in place of
            the --gray-12 set for headers and values above. On the --slate-2
            header it's 5.65:1 in light mode and 8.45:1 in dark, above WCAG
            AA's 4.5:1 (--slate-10, tried first, was 3.6:1). The sort arrows
            follow it. */
          color: var(--slate-11);
          /* Centred top to bottom in the grey row (set in review). */
          vertical-align: middle;
          /* 36px tall (set in review; tried 32px and 34px; the table's own
            is 44px). The height overrides Radix's 44px minimum, which header
            cells share with body cells (--table-cell-min-height); padding
            alone can't go below it. 10px above and below the 16px line keeps
            the label centred; the sides are unchanged. */
          height: 36px;
          padding-top: 10px;
          padding-bottom: 10px;
          /* The top line is the table's top edge, part of its outline
            (--slate-a5); the line under the header matches the lines between
            rows, --gray-a3 (set in review; tried --gray-a4, a step darker,
            and a grey fill instead of a line). */
          box-shadow:
            inset 0 1px 0 0 var(--slate-a5),
            inset 0 -1px 0 0 var(--gray-a3);
        }
        /* The label and its sort icon centred on one line, 4px apart, so
          the icon lines up with the 12px text rather than its baseline. */
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableColumnHeaderCell
          > .cursor-pointer {
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
          vertical-align: middle;
        }
        .contents.experiments
          [data-table-list][data-table-list]
          .rt-TableColumnHeaderCell
          > .cursor-pointer
          > a {
          display: inline-flex;
          align-items: center;
        }
      `}</style>
      <div
        className="contents experiments container-fluid pagecontents"
        data-compact-rows={compactRows ? "true" : undefined}
        data-tab-direction={listTabDirection ?? undefined}
        onAnimationEnd={(e) => {
          // Only the tables' own entrance; animations inside bubble too.
          if (
            e.target instanceof HTMLElement &&
            e.target.classList.contains("rt-TabsContent")
          ) {
            setListTabDirection(null);
          }
        }}
        // The experiment details page's spacing (set in review): 24px above
        // the title, 32px left, right and below, and no max width, instead of
        // the shared 15px and 1340px (global.scss).
        style={{
          padding: "var(--space-5) var(--space-6) var(--space-6)",
          maxWidth: "none",
        }}
      >
        {/* No top margin: the wrapper's 24px is the gap above the title. */}
        <div className="mb-3">
          {/* The experiment details page's title row (set in review): 40px
            tall, the title in Heading xl, medium weight, in the page's text
            colour, and the buttons on the right, 16px apart (8px on the
            details page; trying 16px here in review). */}
          {/* Top-aligned, as the details page's title row (set in review):
            centred, the 30px title sat 5px lower than there, and the page
            shifted on navigation. Still 40px tall, so nothing below moves. */}
          <Flex
            align="start"
            justify="between"
            gap="5"
            style={{ minHeight: 40 }}
          >
            <Heading as="h1" size="xl" weight="medium" mb="0">
              Experiments
            </Heading>
            <Flex align="center" gap="4" flexShrink="0">
              {showViewSampleButton && <ViewSampleDataButton />}
              {addExperimentButtons}
            </Flex>
          </Flex>
          <CustomMarkdown page={"experimentList"} />
          {!hasExperiments && analyzeExisting ? (
            <EmptyState
              title="Analyze Experiment Results"
              description="Use our powerful query and stats engine to analyze experiment results using data from your warehouse."
              leftButton={
                <LinkButton
                  href="https://docs.growthbook.io/app/importing-experiments"
                  variant="outline"
                  external
                >
                  View docs
                </LinkButton>
              }
              rightButton={
                <Tooltip
                  body="You don't have permission to import experiments in this project."
                  shouldDisplay={!canAddExperiment}
                >
                  <Button
                    disabled={!canAddExperiment}
                    onClick={() => setOpenImportExperimentModal(true)}
                  >
                    Import Existing Experiment
                  </Button>
                </Tooltip>
              }
            />
          ) : !hasExperiments && !analyzeExisting ? (
            <>
              <EmptyState
                title="Create Your First Experiment"
                description="Run unlimited tests with linked feature flags, URL redirects or the Visual Editor."
                leftButton={
                  <LinkButton
                    href="https://docs.growthbook.io/experiments"
                    variant="outline"
                    external
                  >
                    View docs
                  </LinkButton>
                }
                rightButton={
                  <Tooltip
                    body="You don't have permission to create experiments in this project."
                    shouldDisplay={!canAddExperiment}
                  >
                    <Button
                      disabled={!canAddExperiment}
                      onClick={() => setOpenNewExperimentModal(true)}
                    >
                      Create New Experiment
                    </Button>
                  </Tooltip>
                }
              />
              <Callout status="info">
                Want to analyze results of an existing experiment that you ran
                elsewhere?{" "}
                <Link href="/getstarted/imported-experiment-guide">
                  Learn More
                </Link>
              </Callout>
            </>
          ) : (
            hasExperiments && (
              <>
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => {
                    if (isExperimentListTab(value)) {
                      setTab(value);
                    }
                  }}
                >
                  {/* The experiment details page's tab bar (set in review):
                    size md, inactive tabs in regular weight and the page's
                    text colour, 4px around each tab's hover highlight, and
                    12px between tabs. Its divider spans the content width
                    only, lined up with the title and table, not edge to edge
                    as on the details page (set in review). 4px below the
                    title row (set in review; there was no gap). */}
                  <Box mt="1" mb="3" position="relative">
                    <Box
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 1,
                        backgroundColor: "var(--gray-a5)",
                        pointerEvents: "none",
                      }}
                    />
                    <TabsList
                      size="md"
                      className={headerStyles.setupTabs}
                      style={
                        {
                          boxShadow: "none",
                          "--tab-padding-x": "var(--space-1)",
                        } as CSSProperties
                      }
                    >
                      <Flex align="center" gap="3">
                        <TabsTrigger value="all" style={tabWeight("all")}>
                          All
                        </TabsTrigger>
                        {["running", "drafts", "stopped", "archived"].map(
                          (tabValue, i) => {
                            if (tabValue === "archived" && !hasArchived)
                              return null;

                            return (
                              <TabsTrigger
                                value={tabValue}
                                key={tabValue + i}
                                style={tabWeight(tabValue)}
                              >
                                {tabValue.slice(0, 1).toUpperCase()}
                                {tabValue.slice(1)}
                                {tabValue !== "archived" && (
                                  // Just the number, no badge (set in
                                  // review): 8px after the label, 12px, in
                                  // --gray-11 (tried --gray-10: 3.8:1, below
                                  // WCAG AA for text this size).
                                  <span
                                    style={{
                                      marginLeft: "var(--space-2)",
                                      fontSize: "var(--font-size-1)",
                                      color: "var(--gray-11)",
                                    }}
                                  >
                                    {tabCounts[tabValue] || 0}
                                  </span>
                                )}
                              </TabsTrigger>
                            );
                          },
                        )}
                      </Flex>
                    </TabsList>
                  </Box>
                  {/* Search, then the filters flowing right from it, 12px
                    after (set in review); the row's right side is kept free
                    for table controls. */}
                  <Flex gap="3" align="center" mb="4" wrap="wrap">
                    <Box flexBasis="300px" flexShrink="0">
                      {/* @/ui/TextField, as the experiment details page's
                        fields (set in review; was the legacy Field), with a
                        search icon before the placeholder. */}
                      <TextField
                        placeholder="Search"
                        type="search"
                        prepend={
                          <PiMagnifyingGlassBold
                            size={14}
                            // --slate-9 (set in review; tried --slate-10,
                            // and --slate-8, which was below 3:1): 3.3:1 on
                            // white, 3.43:1 in dark mode, above the 3:1 WCAG
                            // asks of icons.
                            style={{ color: "var(--slate-9)" }}
                          />
                        }
                        {...searchInputProps}
                        ref={searchFieldRef}
                        // A clear button while there's a search (set in
                        // review): empties it and returns the cursor to the
                        // field. FALLBACK: Radix IconButton; @/ui/ has no
                        // icon button.
                        append={
                          searchInputProps.value ? (
                            <IconButton
                              variant="ghost"
                              color="gray"
                              size="1"
                              radius="full"
                              aria-label="Clear search"
                              onClick={() => {
                                setSearchValue("");
                                searchFieldRef.current?.focus();
                              }}
                            >
                              <PiXBold
                                size={12}
                                // --slate-11 (set in review; tried --slate-9
                                // and --slate-12).
                                style={{ color: "var(--slate-11)" }}
                              />
                            </IconButton>
                          ) : undefined
                        }
                      />
                    </Box>
                    <ExperimentSearchFilters
                      searchInputProps={searchInputProps}
                      syntaxFilters={syntaxFilters}
                      setSearchValue={setSearchValue}
                      experiments={allExperiments}
                      includeTempRollouts
                      // Status and Health always; the rest via "Add
                      // Filter" (set in review).
                      defaultFilters={["status", "health"]}
                    />
                    {/* Table controls, at the row's right end (set in
                      review): row density, then column settings, as one
                      outlined button group. FALLBACK: Radix IconButton;
                      @/ui/ has no icon button or button group. */}
                    <Flex
                      ml="auto"
                      align="center"
                      className="experiments-table-controls"
                      role="group"
                      aria-label="Table display"
                    >
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="none"
                        size="1"
                        highContrast
                        aria-pressed={compactRows}
                        aria-label="Compact rows"
                        title={
                          compactRows ? "Comfortable rows" : "Compact rows"
                        }
                        onClick={() => setCompactRows(!compactRows)}
                      >
                        {compactRows ? (
                          <PiArrowsOutLineVerticalBold size={12} />
                        ) : (
                          <PiArrowsInLineVerticalBold size={12} />
                        )}
                      </IconButton>
                      <span
                        className="experiments-table-controls-divider"
                        aria-hidden
                      />
                      <ColumnSettingsButton
                        columns={listColumns.columns
                          // Experiment can't be hidden or moved.
                          .filter((c) => !c.locked)
                          .map((c) => ({
                            id: c.id,
                            label: c.label,
                            visible: c.visible,
                            alwaysVisible: c.hideable === false,
                          }))}
                        hiddenCount={listColumns.hiddenCount}
                        canReset={listColumns.isCustomized}
                        onReset={listColumns.reset}
                        onChange={listColumns.applySettings}
                        note="The Experiment column is always shown."
                        trigger={
                          <IconButton
                            variant="ghost"
                            color="gray"
                            radius="none"
                            size="1"
                            highContrast
                            aria-label={
                              listColumns.hiddenCount > 0
                                ? `Columns, ${listColumns.hiddenCount} hidden`
                                : "Columns"
                            }
                            title="Show or hide columns"
                          >
                            <PiTextColumnsBold size={12} />
                          </IconButton>
                        }
                      />
                    </Flex>
                  </Flex>
                  <TabsContent value="all">
                    <ExperimentsListTable
                      showWatchColumn={false}
                      animateSort
                      fixedColumns
                      hiddenColumns={["owner", "date", "result"]}
                      statusFirst
                      resizableColumnsKey="experiments-page"
                      tableColumns={listColumns}
                      tab="all"
                      SortableTableColumnHeader={SortableTableColumnHeader}
                      filtered={filtered}
                      isFiltered={isFiltered}
                      project={project}
                      searchValue={searchInputProps.value}
                      setSearchValue={setSearchValue}
                    />
                  </TabsContent>
                  {["running", "drafts", "stopped", "archived"].map((tab) => {
                    if (tab === "archived" && !hasArchived) return null;
                    return (
                      <TabsContent value={tab} key={tab}>
                        <ExperimentsListTable
                          showWatchColumn={false}
                          animateSort
                          fixedColumns
                          hiddenColumns={["owner", "date", "result"]}
                          statusFirst
                          resizableColumnsKey="experiments-page"
                          tableColumns={listColumns}
                          tab={tab}
                          SortableTableColumnHeader={SortableTableColumnHeader}
                          filtered={filtered.filter((e) => e.tab === tab)}
                          isFiltered={isFiltered}
                          project={project}
                          searchValue={searchInputProps.value}
                          setSearchValue={setSearchValue}
                        />
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </>
            )
          )}
        </div>
      </div>
      {openNewExperimentModal && (
        <CreateExperimentModal
          onClose={() => setOpenNewExperimentModal(false)}
          source="experiment-list"
        />
      )}
      {openImportExperimentModal && (
        <ImportExperimentModal
          onClose={() => setOpenImportExperimentModal(false)}
          source="experiment-list"
        />
      )}
    </>
  );
};

export default ExperimentsPage;
