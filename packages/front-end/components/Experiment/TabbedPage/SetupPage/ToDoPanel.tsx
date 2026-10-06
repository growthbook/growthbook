import { useId, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretRight } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { DeliveryMethod } from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import Text from "@/ui/Text";
import Collapse from "./Collapse";
import styles from "./SetupRail.module.scss";

// The rail's To Do list, per the design (PageRail.dc.html): a short list in
// two groups, "Required to Start" and "Required for Results", instead of the
// product's pre-launch checklist. Each item says what to do and where on the
// page it's done, and jumps there when clicked.
//
// "Required to Start" is the same rule as the header's Start button: saved
// values for the Values type, or a linked change of the current type for the
// others. For Feature Flag experiments it also lists each linked flag the
// Start modal would refuse to start with (merge conflict, pending approval,
// or unrelated draft changes).
//
// It's the first block of the rail's Details tab (moved there in review; it
// had been its own To Do tab), headed "To Do" with the outstanding count.

export interface ToDoItem {
  id: string;
  title: string;
  location: string;
  done: boolean;
  onSelect?: () => void;
}

export interface ToDoGroups {
  start: ToDoItem[];
  results: ToDoItem[];
  openCount: number;
}

const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Jump to the control an item is about: scroll it to the middle of the
// window and focus it, so it shows its own focus styling. When there's
// nothing focusable (read-only text on a running experiment, or a whole
// section), the element itself takes focus and gets a temporary focus ring.
export function focusSetupTarget(
  containers: HTMLElement[],
  // Picks the element to focus among each container's focusable elements.
  // Defaults to the first one.
  pick: (focusables: HTMLElement[]) => HTMLElement | undefined = (f) => f[0],
  // Centre the container instead of the control focused inside it: for a
  // field whose focusable part is small and off to one side (the metric
  // picker's text input sits at its top left), so the whole field lands in
  // the middle of the screen (set in review). Optional and additive.
  centerContainer = false,
) {
  if (!containers.length) return;
  let target: HTMLElement | undefined;
  for (const c of containers) {
    target = pick(Array.from(c.querySelectorAll<HTMLElement>(FOCUSABLE)));
    if (target) break;
  }
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const el = target ?? containers[0];
  // Centred on the whole window, the sticky header and tabs included (set
  // in review). scrollIntoView's "center" leaves out the page's
  // scroll-padding-top (the header's height), so it centred between the
  // header and the bottom of the screen, below the true middle.
  const rect = (centerContainer ? containers[0] : el).getBoundingClientRect();
  window.scrollTo({
    top: window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2,
    behavior: reduceMotion ? "auto" : "smooth",
  });
  if (!target) {
    // Not normally focusable: make it focusable just for this, and show a
    // ring (the browser's own focus styling doesn't apply to a plain div).
    el.setAttribute("tabindex", "-1");
    el.classList.add(styles.focusTarget);
    el.addEventListener(
      "blur",
      () => {
        el.classList.remove(styles.focusTarget);
        el.removeAttribute("tabindex");
      },
      { once: true },
    );
  }
  el.focus({ preventScroll: true });
}

function byId(id: string): HTMLElement[] {
  const el = document.getElementById(id);
  return el ? [el] : [];
}

// The value fields, in variation order.
function valueCells(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[id^="setup-value-"]'),
  );
}

const REFERENCE_ITEM: Record<
  Exclude<DeliveryMethod, "values">,
  { title: string; location: string }
> = {
  "feature-flag": {
    title: "Link a Feature Flag",
    location: "Implementation · Feature Flags",
  },
  "visual-editor": {
    title: "Add Visual Editor Changes",
    location: "Implementation · Visual Editor Changes",
  },
  "url-redirect": {
    title: "Add a URL Redirect",
    location: "Implementation · URL Redirects",
  },
};

export function getSetupToDos({
  experiment,
  deliveryType,
  hasSavedValues,
  linkedFeatures,
  visualChangesetCount,
  urlRedirectCount,
  hasDataSource,
  onEditDataSource,
}: {
  experiment: ExperimentInterfaceStringDates;
  deliveryType: DeliveryMethod;
  hasSavedValues: boolean;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesetCount: number;
  urlRedirectCount: number;
  hasDataSource: boolean;
  onEditDataSource?: () => void;
}): ToDoGroups {
  // The first EMPTY value field, falling back to the first field.
  const toValues = () => {
    const cells = valueCells();
    const empty = cells.find((c) => {
      const input = c.querySelector("input");
      return !!input && input.value === "";
    });
    focusSetupTarget(empty ? [empty, ...cells] : cells);
  };
  // The linked changes section's add button (its empty state's CTA, or the
  // "Add ..." button under existing items).
  const toLinkedChanges = () => focusSetupTarget(byId("linked-feature-flags"));
  // The section itself: there's no single control for one flag's problem.
  const toLinkedChangesSection = () =>
    focusSetupTarget(byId("linked-feature-flags"), () => undefined);
  // The whole Goal Metrics field centred on screen, its input focused.
  const toGoalMetrics = () =>
    focusSetupTarget(byId("setup-goal-metrics"), undefined, true);

  const start: ToDoItem[] = [];
  if (deliveryType === "values") {
    start.push({
      id: "values",
      title: "Set Variation Values",
      location: "Implementation · Values",
      done: hasSavedValues,
      onSelect: toValues,
    });
  } else {
    const count =
      deliveryType === "feature-flag"
        ? linkedFeatures.length
        : deliveryType === "visual-editor"
          ? visualChangesetCount
          : urlRedirectCount;
    start.push({
      id: "linked",
      ...REFERENCE_ITEM[deliveryType],
      done: count > 0,
      onSelect: toLinkedChanges,
    });
    if (deliveryType === "feature-flag") {
      // Linked flags whose draft blocks the Start modal, by name, as the
      // design lists them.
      linkedFeatures
        .filter(
          (f) =>
            f.state === "draft" &&
            (f.hasMergeConflict ||
              f.hasUnrelatedDraftChanges ||
              (f.pendingApproval && f.draftRevisionStatus !== "approved")),
        )
        .forEach((f) =>
          start.push({
            id: `flag-${f.feature.id}`,
            title: f.feature.id,
            location: "Implementation · Feature Flags",
            done: false,
            onSelect: toLinkedChangesSection,
          }),
        );
    }
  }

  const results: ToDoItem[] = [
    {
      id: "datasource",
      title: "Choose a Data Source and Assignment Query",
      location: "Analysis Plan · Source",
      done: hasDataSource,
      onSelect: onEditDataSource,
    },
    {
      id: "goal",
      title: "Add a Goal Metric",
      location: "Analysis Plan · Goal",
      done: (experiment.goalMetrics ?? []).length > 0,
      onSelect: toGoalMetrics,
    },
  ];

  const openCount = [...start, ...results].filter((i) => !i.done).length;
  return { start, results, openCount };
}

// Open: an empty ring. Done: the ring filled faintly, with a violet check.
function StatusRing({ done }: { done: boolean }) {
  return (
    <Flex
      align="center"
      justify="center"
      flexShrink="0"
      style={{
        width: 15,
        height: 15,
        marginTop: 1,
        borderRadius: "50%",
        border: "1px solid var(--slate-8)",
        backgroundColor: done ? "var(--slate-2)" : undefined,
        color: "var(--violet-9)",
      }}
    >
      {done ? (
        // Drawn as a stroked path, like the design's, so the stroke can be
        // heavier than Phosphor's heaviest check (PiCheckBold) at this size.
        <svg
          width="9"
          height="9"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3.2 8.3 6.3 11.4 12.9 4.8" />
        </svg>
      ) : null}
    </Flex>
  );
}

function Item({ item, note }: { item: ToDoItem; note?: string }) {
  // The title, and under it an optional muted note ("Required to start" on
  // the items that block Start; set in review, in place of the group
  // labels). The note has the styling the location line had before it was
  // removed: --slate-10 (the Details tab's "Identifier Type" line), 2px
  // below the title. The title looks like the Details tab's values ("Inline
  // Values": 12px, regular, the inherited text colour), set in review.
  //
  // Done items keep the same colours at reduced opacity (set in review): the
  // title at 50%, the note at 70%. The ring stays at full strength so the
  // check reads clearly.
  const body = (
    <Flex align="start" gap="3" width="100%">
      <StatusRing done={item.done} />
      <Box minWidth="0">
        <Box style={item.done ? { opacity: 0.5 } : undefined}>
          <Text as="div" size="sm">
            {item.title}
          </Text>
        </Box>
        {note ? (
          // Off the text tokens, so set on a wrapper that Text inherits from.
          <Box
            style={{
              color: "var(--slate-10)",
              opacity: item.done ? 0.7 : undefined,
              marginTop: 2,
            }}
          >
            <Text as="div" size="sm">
              {note}
            </Text>
          </Box>
        ) : null}
      </Box>
    </Flex>
  );
  // A real button when it does something, so it's keyboard reachable: the
  // whole row, with a light hover background (back from a title-only link,
  // set in review).
  return item.onSelect ? (
    <button
      type="button"
      className={styles.todoItem}
      onClick={item.onSelect}
      aria-label={`${item.title}${note ? `, ${note}` : ""}${
        item.done ? " (done)" : ""
      }`}
    >
      {body}
    </button>
  ) : (
    <div className={styles.todoItem}>{body}</div>
  );
}

// A titled list of To Do rows: the header's disabled-Start popover shows
// its "Required to Start" items with it, in the rail's rows.
export function ToDoGroup({
  title,
  items,
}: {
  title: string;
  items: ToDoItem[];
}) {
  return (
    <Box>
      {/* --slate-11, the same colour as the Details tab's field labels
        (RailLabel). Off the text tokens, so set on a wrapper that Text
        inherits from. */}
      <Box mb="1" style={{ color: "var(--slate-11)" }}>
        <Text as="div" size="sm">
          {title}
        </Text>
      </Box>
      <Flex direction="column" gap="1">
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </Flex>
    </Box>
  );
}

export default function ToDoPanel({ groups }: { groups: ToDoGroups }) {
  // One list under a "To Do" accordion (set in review; it had been two
  // labelled groups, "Required for Results" collapsible). Open to start.
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  // Always the full list: once everything is done, the checked items are
  // the confirmation, rather than an empty "No open items".
  return (
    <Box>
      {/* The heading row is the toggle, with the mechanics of the Details
        tab's Data group (RailGroup in SetupRail.tsx): the rail's light grey
        hover (.editableRow; its negative margins keep the text where it
        was) on this row only, a chevron at its right edge that points right
        while closed and turns down when open (the shared .accordionCaret),
        and the chevron as the button for keyboard and screen readers. The
        tasks keep their own hover. 8px between the row and the first task
        (their own 8px padding makes 16px of space between the texts), inside
        the part that opens and closes, so closed takes no room. */}
      <Box>
        <Flex
          align="center"
          justify="between"
          gap="1"
          className={styles.editableRow}
          onClick={() => setOpen(!open)}
          style={{ cursor: "pointer" }}
        >
          {/* An eyebrow, as the Data group's title (.railEyebrow; set in
            review), with the outstanding count as part of it, "TO DO (3)"
            (set in review). No count at zero. */}
          <Box className={styles.railEyebrow}>
            <Text as="div" size="inherit" weight="medium">
              {groups.openCount ? `To Do (${groups.openCount})` : "To Do"}
            </Text>
          </Box>
          {/* As Data's chevron (12px caret in --slate-9, ghost size 1),
            pulled 6px right so the caret itself, not its 24px button, ends
            at the rail's text edge. FALLBACK: Radix IconButton; @/ui/ has no
            icon button or accordion. Its click bubbles up to the row. */}
          <IconButton
            variant="ghost"
            color="gray"
            radius="full"
            size="1"
            style={{ marginRight: -6, color: "var(--slate-9)" }}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? "Hide To Do" : "Show To Do"}
          >
            <PiCaretRight
              size="12"
              className={styles.accordionCaret}
              data-open={open ? "true" : "false"}
            />
          </IconButton>
        </Flex>
      </Box>
      {/* Opens and closes smoothly (set in review; see Collapse). The
        blocking-Start items first, each noted "Required to start", then the
        rest, with no group labels (set in review). */}
      <Collapse open={open} id={bodyId}>
        <Flex direction="column" gap="1" pt="2">
          {groups.start.map((item) => (
            <Item key={item.id} item={item} note="Required to start" />
          ))}
          {groups.results.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </Flex>
      </Collapse>
    </Box>
  );
}
