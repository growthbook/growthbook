import {
  CSSProperties,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretRight, PiPencilSimple, PiWarningFill } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { datetime } from "shared/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useHoldouts } from "@/hooks/useHoldouts";
import Owner from "@/components/Avatar/Owner";
import SortedTags from "@/components/Tags/SortedTags";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import {
  DELIVERY_METHOD_LABELS,
  DeliveryMethod,
  useExperimentType,
  useManagedValues,
} from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import EditDescriptionModal from "@/components/Experiment/EditDescriptionModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import Tooltip from "@/ui/Tooltip";
import EditProjectModal from "./EditProjectModal";
import EditTagsModal from "./EditTagsModal";
import EditOwnerModal from "./EditOwnerModal";
import ToDoPanel, { getSetupToDos, ToDoGroups } from "./ToDoPanel";
import RailComments from "./RailComments";
import Collapse from "./Collapse";
import RailDivider from "./RailDivider";
import type { SetupDraft } from "./setupDraft";
import { readAiSetupSpec } from "./aiSetupFixture";
import styles from "./SetupRail.module.scss";

// The design's right rail. 280px, set in review (the design file shows it
// narrower); it sits beside the page content rather than inside it so it
// spans the full height of the tab.
export const RAIL_WIDTH_PX = 280;
// Where the rail pins: just under the page's tab bar once it's pinned. The
// tab bar pins at --experiment-tabs-top (under the top nav and the sticky
// title row, which sets it; see ExperimentHeader.tsx) and is 40px tall.
const RAIL_STICKY_TOP = "calc(var(--experiment-tabs-top, 55px) + 40px)";
function railStickyTopPx(): number {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--experiment-tabs-top",
    ),
  );
  return (Number.isNaN(v) ? 55 : v) + 40;
}

// The Details tab's pencils: the same button as the comments' kebab (ghost,
// gray high contrast, round, size 2 with a 14px icon; set in review). Size 2
// has 8px of padding, and Radix pulls a ghost button 8px outward with
// negative margins so it takes no extra room. Cancelling 6px of that on the
// left puts the icon 10px after the label (the row's 4px gap plus 8px of
// padding, less 2px), set in review. OFF THE SPACE SCALE, so a raw value.
const EDIT_BUTTON_MARGIN_LEFT = "-2px";
// Left/right padding for the rail's tabs and content, set in review. 20px
// isn't on the Radix space scale (16 → 24), so it's a raw value.
const RAIL_PADDING_X = "20px";

function statusLabel(experiment: ExperimentInterfaceStringDates): string {
  if (experiment.archived) return "Archived";
  const s = experiment.status;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A titled group of fields ("General", "Data"). The eyebrow sits 16px above
// its first field, the same as the gap between fields, set in review.
// mt="1" adds 4px above the group, on top of the list's 16px gap.
function RailGroup({
  title,
  children,
  warning,
  onEdit,
  editLabel,
  collapsible = false,
  open: openWhenCollapsible = false,
  onOpenChange,
}: {
  title: string;
  children: ReactNode;
  // Shown as an amber warning icon right after the eyebrow.
  warning?: string;
  // Makes the whole group one editable unit: the same hover background and
  // pencil as an editable field (see SetupRail.module.scss), with the pencil
  // on the eyebrow's line.
  onEdit?: () => void;
  editLabel?: string;
  // An accordion: the fields fold away under the title, with a chevron
  // at the row's right edge to open and close them. Set in review, for Data
  // once it's complete. Open or closed is the caller's (so it can be
  // remembered); while not collapsible the group is always open, so a
  // missing setting is never hidden.
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const open = !collapsible || openWhenCollapsible;
  const bodyId = useId();
  const toggle = () => onOpenChange?.(!open);
  return (
    // The 4px above the eyebrow sits outside the hover area, so the area's
    // padding is even top and bottom (the chevron centres in it when
    // closed).
    <Box mt="1">
      {/* The whole row opens and closes the accordion, not just the chevron
        (set in review): closed, that's the whole hover area; open, the
        eyebrow's line, so clicks in the fields below don't close it. The
        chevron is the button for keyboard and screen readers; its click
        bubbles up to these handlers. */}
      <Flex
        direction="column"
        className={onEdit ? styles.editableRow : undefined}
        onClick={collapsible && !open ? toggle : undefined}
        style={collapsible && !open ? { cursor: "pointer" } : undefined}
      >
        <Flex
          align="center"
          justify="between"
          gap="1"
          onClick={collapsible && open ? toggle : undefined}
          style={collapsible && open ? { cursor: "pointer" } : undefined}
        >
          {/* The title, warning and pencil together on the left; the
            chevron, if any, on the right. */}
          <Flex align="center" gap="1">
            {/* An eyebrow (.railEyebrow; set in review), as the To Do
              list's heading. */}
            <Box className={styles.railEyebrow}>
              <Text as="div" size="inherit" weight="medium">
                {title}
              </Text>
            </Box>
            {warning ? (
              <Tooltip content={warning}>
                <Flex
                  role="img"
                  aria-label={warning}
                  style={{ color: "var(--amber-11)" }}
                >
                  <PiWarningFill size="12" />
                </Flex>
              </Tooltip>
            ) : null}
            {onEdit ? (
              // Same pencil as the fields (see RailField).
              <IconButton
                className={styles.editButton}
                variant="ghost"
                color="gray"
                highContrast
                radius="full"
                size="2"
                style={{ marginLeft: EDIT_BUTTON_MARGIN_LEFT }}
                onClick={(e) => {
                  // Editing shouldn't also open or close the accordion.
                  e.stopPropagation();
                  onEdit();
                }}
                aria-label={editLabel ?? `Edit ${title}`}
              >
                <PiPencilSimple size="14" />
              </IconButton>
            ) : null}
          </Flex>
          {collapsible ? (
            // At the row's right edge, as the To Do list's "Required for
            // Results" has it (set in review; it had been left of the title),
            // in --slate-9. Points right while closed and turns to point down
            // when open. Pulled 6px right so the 12px caret itself, not its
            // 24px button, ends at the rail's text edge. FALLBACK: Radix
            // IconButton; @/ui/ has no icon button or accordion.
            <IconButton
              variant="ghost"
              color="gray"
              radius="full"
              size="1"
              style={{ marginRight: -6, color: "var(--slate-9)" }}
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={
                open ? `Hide ${title} details` : `Show ${title} details`
              }
            >
              <PiCaretRight
                size="12"
                className={styles.accordionCaret}
                data-open={open ? "true" : "false"}
              />
            </IconButton>
          ) : null}
        </Flex>
        {/* Opens and closes smoothly (set in review; see Collapse). The
          16px between the title and the first field is inside, so closed
          takes no room. Always open while not collapsible. */}
        <Collapse open={open} id={bodyId}>
          <Flex direction="column" gap="4" pt="4">
            {children}
          </Flex>
        </Collapse>
      </Flex>
    </Box>
  );
}

// A field label. --slate-11, set in review. OFF THE TEXT TOKENS: Text's
// color prop only takes text-high/mid/low/disabled, so the colour is set on
// a wrapper and Text inherits it.
function RailLabel({ children }: { children: ReactNode }) {
  return (
    <Box style={{ color: "var(--slate-11)" }}>
      <Text as="div" size="sm">
        {children}
      </Text>
    </Box>
  );
}

// Monospace value (Feature Key, Experiment Key). There's no Code typography
// component in @/ui/, so this is a plain <code> for the font. Its colour is
// reset to inherit: Bootstrap's global `code` style makes it pink
// ($code-color), which set these apart from every other value.
//
// 12px, set in review: an explicit size overrides Bootstrap's 87.5% shrink
// (which put these at about 10.5px), matching the other values. Applies only
// to these code values.
function RailCode({ children }: { children: ReactNode }) {
  return <code style={{ color: "inherit", fontSize: "12px" }}>{children}</code>;
}

// One label/value pair. Absent values read as "--" (the design's
// placeholder, set in review), not "None" — "None" reads as a settled answer.
// Values are 12px (Text size="small"), the same size as their labels, set in
// review. Every value below sets it explicitly: Text doesn't inherit size.
//
// With onEdit, the row gets a pencil on its label's line, just after it, and
// a light grey background on hover or focus (see SetupRail.module.scss). The
// pencil is always in the layout, so nothing reflows when it appears.
function Field({
  label,
  children,
  onEdit,
  editLabel,
}: {
  label: string;
  children?: ReactNode;
  onEdit?: () => void;
  editLabel?: string;
}) {
  if (onEdit) {
    return (
      <Box className={styles.editableRow}>
        {/* Pencil on the label's line, just after the label (set in
          review). See EDIT_BUTTON_MARGIN_LEFT for the spacing. */}
        <Flex align="center" gap="1">
          <RailLabel>{label}</RailLabel>
          <IconButton
            className={styles.editButton}
            variant="ghost"
            color="gray"
            highContrast
            radius="full"
            size="2"
            style={{ marginLeft: EDIT_BUTTON_MARGIN_LEFT }}
            onClick={onEdit}
            aria-label={editLabel ?? `Edit ${label}`}
          >
            <PiPencilSimple size="14" />
          </IconButton>
        </Flex>
        <Box>
          {children ?? (
            <Text size="sm" color="text-low">
              --
            </Text>
          )}
        </Box>
      </Box>
    );
  }
  return (
    <Box>
      <RailLabel>{label}</RailLabel>
      {/* No gap between label and value, set in review. */}
      <Box>
        {children ?? (
          <Text size="sm" color="text-low">
            --
          </Text>
        )}
      </Box>
    </Box>
  );
}

// The rail's names for each type, as the design renders them. "Inline Values"
// is the design's name for the Values type; the other three match
// DELIVERY_METHOD_LABELS.
const RAIL_TYPE_LABELS: Record<DeliveryMethod, string> = {
  ...DELIVERY_METHOD_LABELS,
  values: "Inline Values",
};

function Details({
  experiment,
  onChangeType,
  mutate,
  canEdit,
  onEditData,
  todos,
  deliveryType,
  onDraftChange,
}: {
  experiment: ExperimentInterfaceStringDates;
  onChangeType?: () => void;
  mutate: () => void;
  canEdit: boolean;
  // Opens Edit Data Source. The modal lives on the rail, not in this tab, so
  // it stays mounted while the Comments tab is showing (inactive tabs
  // unmount).
  onEditData: () => void;
  // The To Do list, shown first (before launch only), or null.
  todos: ToDoGroups | null;
  // The type to show (the draft's, when there's a draft).
  deliveryType: DeliveryMethod;
  // A draft experiment: Description, Project and Tags apply to the Setup
  // page's draft (set in review) instead of saving straight away.
  onDraftChange?: (patch: Partial<SetupDraft>) => void;
}) {
  const permissionsUtil = usePermissionsUtil();
  // Kept in this browser at creation (see aiSetupFixture.ts).
  const [spec] = useState(() => readAiSetupSpec(experiment.id));
  // Whether the Data accordion is open. It starts open while there's no
  // data source yet (it needs one) and closed once there is (set in review;
  // it had been remembered in this browser). Open or close it freely after.
  const [dataOpen, setDataOpen] = useState(() => !experiment.datasource);

  // Each editable field opens its own single-field modal (Description reuses
  // the product's EditDescriptionModal), with the same permission rules as
  // the old header metadata row. Holdout is read-only here.
  const [editing, setEditing] = useState<
    null | "description" | "project" | "tags" | "owner"
  >(null);
  const canEditProject =
    canEdit && permissionsUtil.canUpdateExperiment(experiment, {});
  const { config: managedValues } = useManagedValues();
  const { getProjectById, getDatasourceById } = useDefinitions();
  const { holdoutsMap } = useHoldouts();

  const project = experiment.project
    ? getProjectById(experiment.project)
    : null;
  const holdout = experiment.holdoutId
    ? holdoutsMap.get(experiment.holdoutId)
    : null;
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  const assignmentQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );

  return (
    // 64px under the last field (Experiment Key), set in review, so the end
    // of the list isn't flush with the bottom of the rail's scroll area.
    <Flex direction="column" gap="4" style={{ paddingBottom: 64 }}>
      {editing === "description" ? (
        <EditDescriptionModal
          source="experiment-setup-rail"
          mutate={mutate}
          experimentId={experiment.id}
          experimentType={experiment.type}
          initialValue={experiment.description}
          close={() => setEditing(null)}
          // A plain text area, like Hypothesis (set in review).
          plain
          onApply={
            onDraftChange
              ? (description) => onDraftChange({ description })
              : undefined
          }
        />
      ) : null}
      {editing === "project" ? (
        <EditProjectModal
          experiment={experiment}
          close={() => setEditing(null)}
          mutate={mutate}
          onApply={
            onDraftChange ? (project) => onDraftChange({ project }) : undefined
          }
        />
      ) : null}
      {editing === "tags" ? (
        <EditTagsModal
          experiment={experiment}
          close={() => setEditing(null)}
          mutate={mutate}
          onApply={
            onDraftChange ? (tags) => onDraftChange({ tags }) : undefined
          }
        />
      ) : null}
      {editing === "owner" ? (
        <EditOwnerModal
          experiment={experiment}
          close={() => setEditing(null)}
          mutate={mutate}
        />
      ) : null}
      {/* The To Do list, first (set in review; it had been its own rail
        tab), then a divider and the Details fields as before. */}
      {todos ? (
        // A full-bleed band (set in review): pulled out over the panel's
        // 20px side padding and up over its 20px top padding, so it runs
        // edge to edge and starts at the tab line. No fill (removed in
        // review), with a 1px --gray-a5 line along the bottom only (the
        // rail divider's colour; the design's #e6e4ec), no radius. 16px
        // above and below inside it, and the panel's 20px at the sides, so
        // its text lines up with Status and the other labels below.
        <Box
          style={{
            // 4px below, so Status sits 20px under the line (the list's
            // 16px plus 4px, set in review).
            margin: `-${RAIL_PADDING_X} -${RAIL_PADDING_X} var(--space-1)`,
            padding: `var(--space-4) ${RAIL_PADDING_X}`,
            borderBottom: "1px solid var(--gray-a5)",
          }}
        >
          <ToDoPanel groups={todos} />
        </Box>
      ) : null}
      {/* The middle section's eyebrow, "General" (set in review), over
        Status through Tags: the same eyebrow as "To Do" and "Data"
        (.railEyebrow), 16px above Status, as between fields. */}
      <Box className={styles.railEyebrow}>
        <Text as="div" size="inherit" weight="medium">
          General
        </Text>
      </Box>
      <Field label="Status">
        <Text size="sm">{statusLabel(experiment)}</Text>
      </Field>
      <Field
        label="Description"
        onEdit={canEdit ? () => setEditing("description") : undefined}
      >
        {experiment.description ? (
          <Text size="sm" overflowWrap="anywhere">
            {experiment.description}
          </Text>
        ) : undefined}
      </Field>
      {/* The spec file a "Set up with AI" experiment was created from
        (set in review), by name, as plain text: not a link (set in review;
        it had opened the file in a drawer). Only when one was attached: no
        row (not even "--") otherwise. */}
      {spec ? (
        <Field label="Spec">
          <Text size="sm" overflowWrap="anywhere">
            {spec.name}
          </Text>
        </Field>
      ) : null}

      {/* The rest of the General fields, straight after Description with no
        divider between (removed in review): the same 16px as between any
        two fields. */}
      <Flex direction="column" gap="4">
        <Field
          label="Project"
          onEdit={canEditProject ? () => setEditing("project") : undefined}
        >
          {project ? <Text size="sm">{project.name}</Text> : undefined}
        </Field>
        {/* The only place the delivery type is shown or changed. */}
        <Field
          label="Experiment Type"
          onEdit={onChangeType}
          editLabel="Change experiment type"
        >
          <Text size="sm">{RAIL_TYPE_LABELS[deliveryType]}</Text>
        </Field>
        {/* Values only, per the design: the key the values are delivered
          under. Falls back to the experiment key, which the design shows as
          identical, until a key is stored. */}
        {deliveryType === "values" ? (
          <Field label="Feature Key">
            {managedValues?.key || experiment.trackingKey ? (
              <Text size="sm" overflowWrap="anywhere">
                <RailCode>
                  {managedValues?.key || experiment.trackingKey}
                </RailCode>
              </Text>
            ) : undefined}
          </Field>
        ) : null}
        {/* Read-only here. Adding to or removing from a holdout stays in the
          header's menu. */}
        <Field label="Holdout">
          {holdout ? (
            <Link href={`/holdout/${holdout.id}`} size="sm">
              {holdout.name}
            </Link>
          ) : undefined}
        </Field>
        <Field
          label="Owner"
          onEdit={canEdit ? () => setEditing("owner") : undefined}
        >
          {experiment.owner ? (
            <span className={styles.ownerAvatar}>
              <Owner ownerId={experiment.owner} textSize="sm" />
            </span>
          ) : undefined}
        </Field>
        <Field label="Created">
          <Text size="sm">{datetime(experiment.dateCreated)}</Text>
        </Field>
        <Field
          label="Tags"
          onEdit={canEdit ? () => setEditing("tags") : undefined}
        >
          {experiment.tags?.length ? (
            // 2px between the label and the tags, set in review. Off the
            // space scale (4px is its smallest step), so a raw value.
            <Box style={{ marginTop: 2 }}>
              <SortedTags tags={experiment.tags} useFlex />
            </Box>
          ) : undefined}
        </Field>
      </Flex>

      <RailDivider />
      {/* Source and assignment query are one setting (the assignment query
        belongs to the source), so the whole group is the edit target. No
        warning icon, even while either is missing (removed in review): the
        To Do list covers it. */}
      <RailGroup
        title="Data"
        onEdit={canEdit ? onEditData : undefined}
        editLabel="Edit data source"
        // Always an accordion (set in review; it had only been one once the
        // data source and assignment query were both set).
        collapsible
        open={dataOpen}
        onOpenChange={setDataOpen}
      >
        <Field label="Source">
          {datasource ? <Text size="sm">{datasource.name}</Text> : undefined}
        </Field>
        <Field label="Assignment Query">
          {assignmentQuery ? (
            <>
              <Text as="div" size="sm">
                {assignmentQuery.name}
              </Text>
              {/* 2px below the query name, and --slate-10, set in review.
                The colour is off the text tokens (Text's color prop only
                takes text-high/mid/low/disabled), so it's set on the wrapper
                and Text inherits it. */}
              <Box style={{ marginTop: 2, color: "var(--slate-10)" }}>
                <Text as="div" size="sm">
                  Identifier Type: {assignmentQuery.userIdType}
                </Text>
              </Box>
            </>
          ) : undefined}
        </Field>
        <Field label="Experiment Key">
          {experiment.trackingKey ? (
            <Text size="sm" overflowWrap="anywhere">
              <RailCode>{experiment.trackingKey}</RailCode>
            </Text>
          ) : undefined}
        </Field>
      </RailGroup>
    </Flex>
  );
}

export default function SetupRail({
  experiment: savedExperiment,
  draft,
  onChangeType,
  mutate,
  canEdit,
  envs,
  linkedFeatures,
  visualChangesetCount,
  urlRedirectCount,
  collapsed = false,
  bottomInset = 0,
}: {
  experiment: ExperimentInterfaceStringDates;
  // Opens the Change Experiment Type modal. Omit to show the type read-only.
  onChangeType?: () => void;
  mutate: () => void;
  // Whether Description, Project, Owner, Tags and Data get edit pencils.
  canEdit: boolean;
  envs: string[];
  // For the To Do list's "Required to Start" items.
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesetCount: number;
  urlRedirectCount: number;
  // Collapsed from the header's toggle. The rail stays mounted and slides
  // closed, so the change can animate.
  collapsed?: boolean;
  // Height of the page's save bar while it's showing, pinned to the bottom
  // of the window; the rail stops above it.
  bottomInset?: number;
  // A draft experiment (set in review): the rail shows the Setup page's
  // draft, and its Description, Project, Tags, Experiment Type and Data
  // modals apply to it, so the page's save bar saves them, rather than each
  // saving straight away.
  draft?: {
    values: Pick<
      SetupDraft,
      | "description"
      | "project"
      | "tags"
      | "datasource"
      | "exposureQueryId"
      | "trackingKey"
      | "goalMetrics"
      | "secondaryMetrics"
      | "guardrailMetrics"
      | "dataSourceResets"
      | "deliveryType"
    >;
    update: (patch: Partial<SetupDraft>) => void;
  };
}) {
  // What the rail shows and edits: the experiment, with the draft's values
  // when there's a draft.
  const experiment: ExperimentInterfaceStringDates = draft
    ? {
        ...savedExperiment,
        description: draft.values.description,
        project: draft.values.project,
        tags: draft.values.tags,
        datasource: draft.values.datasource,
        exposureQueryId: draft.values.exposureQueryId,
        trackingKey: draft.values.trackingKey,
        goalMetrics: draft.values.goalMetrics,
        secondaryMetrics: draft.values.secondaryMetrics,
        guardrailMetrics: draft.values.guardrailMetrics,
      }
    : savedExperiment;
  const [editingData, setEditingData] = useState(false);

  // The rail's height: from where it actually is down to the bottom of the
  // window. Before the page scrolls, the rail starts below the header, not
  // at its pinned position, so sizing it as if pinned pushed the bottom of
  // its scroll area off-screen. Re-measured on scroll and resize.
  const railRef = useRef<HTMLDivElement>(null);
  const [railMaxHeight, setRailMaxHeight] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = railRef.current;
        if (!el || !el.offsetParent) return; // hidden tab: nothing to size
        const top = Math.max(railStickyTopPx(), el.getBoundingClientRect().top);
        setRailMaxHeight(Math.max(0, window.innerHeight - top - bottomInset));
      });
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // Also when the sticky title row changes height, which moves where the
    // rail pins without a scroll event (it sets a variable on <html>).
    const rootObserver = new MutationObserver(measure);
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    const observer = new ResizeObserver(measure);
    if (railRef.current) observer.observe(railRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
      rootObserver.disconnect();
    };
  }, [bottomInset]);
  const { type: savedType } = useExperimentType();
  const deliveryType = draft?.values.deliveryType ?? savedType;
  const { config: savedValues } = useManagedValues();
  const { getDatasourceById } = useDefinitions();
  const datasource = experiment.datasource
    ? getDatasourceById(experiment.datasource)
    : null;
  const hasDataSource = !!datasource?.settings?.queries?.exposure?.some(
    (e) => e.id === experiment.exposureQueryId,
  );
  const todos = getSetupToDos({
    experiment,
    deliveryType,
    hasSavedValues: Object.values(savedValues?.valuesByVariationId ?? {}).some(
      (v) => v !== "",
    ),
    linkedFeatures,
    visualChangesetCount,
    urlRedirectCount,
    hasDataSource,
    onEditDataSource: canEdit ? () => setEditingData(true) : undefined,
  });
  // To Do only exists before launch; the Running frame in the design drops
  // it.
  const showToDo = experiment.status === "draft";
  const [tab, setTab] = useState<"details" | "comments">("details");
  // Unselected tabs at 400. "normal" is 400, the same as
  // --font-weight-regular; React's style type doesn't accept a var() here.
  const tabWeight = (value: typeof tab): CSSProperties | undefined =>
    tab === value ? undefined : { fontWeight: "normal" };

  return (
    // Outer: the slot in the page, which animates its width to 0 when
    // collapsed (see .railSlide). Inner: the rail itself, always 280px, so it
    // slides out of view instead of squashing.
    <Box
      ref={railRef}
      className={styles.railSlide}
      data-collapsed={collapsed ? "true" : "false"}
      aria-hidden={collapsed || undefined}
      style={{
        width: collapsed ? 0 : RAIL_WIDTH_PX,
        flexShrink: 0,
        overflow: "hidden",
        // Scrolls independently of the page (set in review): pinned under
        // the page's tab bar, at most the rest of the window tall, with its
        // own scroll area below the rail tabs. The rail's left line is the
        // main column's right border (see SetupPage), so it runs the full
        // height of the page even though the rail doesn't.
        position: "sticky",
        top: RAIL_STICKY_TOP,
        // Above the pinned tab bar's drop shadow (the bar is z-index 930 in
        // global.scss), with an opaque background, so the shadow shows over
        // the main content but not the rail (set in review). The rail sits
        // just below the bar, so it only ever covers the shadow.
        zIndex: 931,
        backgroundColor: "var(--color-background)",
        alignSelf: "flex-start",
      }}
    >
      <Box
        style={{
          width: RAIL_WIDTH_PX,
          maxHeight: railMaxHeight ?? `calc(100vh - ${RAIL_STICKY_TOP})`,
          display: "flex",
          flexDirection: "column",
          // 8px between the tab divider above the rail and the rail's own
          // tabs, set in review.
          paddingTop: "var(--space-2)",
        }}
      >
        {editingData ? (
          // The product's analysis form (the one Analysis Settings and the
          // pre-launch checklist open), titled "Edit Data Source" here. Metrics,
          // dates and stats settings are edited elsewhere on this page, so
          // they're turned off.
          <AnalysisForm
            cancel={() => setEditingData(false)}
            experiment={experiment}
            mutate={mutate}
            phase={experiment.phases.length - 1}
            editDates={false}
            editVariationIds={false}
            editMetrics={false}
            source="experiment-setup-rail"
            envs={envs}
            header="Edit Data Source"
            cta="Apply"
            // Stats engine, CUPED, post-stratification and sequential testing
            // live in the Analysis Plan's Advanced section instead.
            hideStatsSettings
            // Straight into editing: this modal exists to change the source.
            alwaysEditDataSource
            // A draft: into the Setup page's draft (set in review), the
            // save bar saves it. The segment and activation metric it
            // clears go in dataSourceResets (see setupDraft.ts).
            onApply={
              draft
                ? (changes) => {
                    const {
                      segment,
                      activationMetric,
                      datasource,
                      exposureQueryId,
                      trackingKey,
                      goalMetrics,
                      secondaryMetrics,
                      guardrailMetrics,
                    } = changes;
                    draft.update({
                      ...(datasource !== undefined ? { datasource } : {}),
                      ...(exposureQueryId !== undefined
                        ? { exposureQueryId }
                        : {}),
                      ...(trackingKey !== undefined ? { trackingKey } : {}),
                      ...(goalMetrics ? { goalMetrics } : {}),
                      ...(secondaryMetrics ? { secondaryMetrics } : {}),
                      ...(guardrailMetrics ? { guardrailMetrics } : {}),
                      ...(segment !== undefined ||
                      activationMetric !== undefined
                        ? {
                            dataSourceResets: {
                              ...draft.values.dataSourceResets,
                              ...(segment !== undefined ? { segment } : {}),
                              ...(activationMetric !== undefined
                                ? { activationMetric }
                                : {}),
                            },
                          }
                        : {}),
                    });
                  }
                : undefined
            }
          />
        ) : null}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          // A column that can shrink below its content, so the panel under the
          // tab row can scroll.
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Same treatment as the page header's tabs on this page (see
          ExperimentHeader.tsx), one size down: size 1 (12px), 4px outside
          each tab's hover highlight, 12px between tabs, unselected tabs at
          400. The 4px is size 1's own default; it's kept explicit so the two
          tab rows stay in step if either size changes. */}
          <TabsList
            size="sm"
            className={styles.railTabs}
            style={
              {
                paddingLeft: RAIL_PADDING_X,
                paddingRight: RAIL_PADDING_X,
                gap: "var(--space-3)",
                "--tab-padding-x": "var(--space-1)",
                // Never shrink: the Tabs column below can shrink so the panel
                // scrolls, and a squeezed tab row clips the active tab's
                // underline (the list hides its overflow).
                flexShrink: 0,
              } as CSSProperties
            }
          >
            <TabsTrigger value="details" style={tabWeight("details")}>
              Details
            </TabsTrigger>
            <TabsTrigger value="comments" style={tabWeight("comments")}>
              Comments
            </TabsTrigger>
          </TabsList>
          {/* 20px below the rail's tab line (set in review; the same raw value
          as the side padding), 16px at the bottom. */}
          <Box
            pb="4"
            style={{
              // The rail's own scroll area; the tab row above stays put.
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              paddingTop: RAIL_PADDING_X,
              paddingLeft: RAIL_PADDING_X,
              paddingRight: RAIL_PADDING_X,
            }}
          >
            <TabsContent value="details">
              <Details
                experiment={experiment}
                onChangeType={onChangeType}
                mutate={mutate}
                canEdit={canEdit}
                onEditData={() => setEditingData(true)}
                todos={showToDo ? todos : null}
                deliveryType={deliveryType}
                onDraftChange={draft?.update}
              />
            </TabsContent>
            <TabsContent value="comments">
              <RailComments experiment={experiment} />
            </TabsContent>
          </Box>
        </Tabs>
      </Box>
    </Box>
  );
}
