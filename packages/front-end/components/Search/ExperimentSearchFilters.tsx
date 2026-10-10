import React, {
  FC,
  Fragment,
  ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PiFunnelSimple } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Tag from "@/components/Tags/Tag";
import {
  BaseSearchFiltersProps,
  ChipRemoveButton,
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { useExperimentFilterCategories } from "@/components/Search/experimentFilterCategories";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { Popover } from "@/ui/Popover";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import listTableStyles from "@/components/Experiment/ExperimentsListTable.module.scss";
import styles from "./ExperimentSearchFilters.module.scss";

// The overflow chip's key for measuring, and the widths assumed before a
// chip has been measured.
const OVERFLOW_KEY = "__overflow";
const OVERFLOW_FALLBACK_WIDTH = 96;
const CHIP_FALLBACK_WIDTH = 100;
// The chips' motion: starts quickly, settles gently, no overshoot.
const CHIP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const ExperimentSearchFilters: FC<
  BaseSearchFiltersProps & {
    experiments: ExperimentInterfaceStringDates[];
    allowDrafts?: boolean;
    showStatusFilter?: boolean;
    includeTempRollouts?: boolean;
    // Filters shown always (by key: "status", "health", ...); the rest wait
    // behind "Add Filter". Absent: every filter shows.
    defaultFilters?: string[];
    // The filters as chips (@/ui/Badge; set in review, on the experiments
    // list). Absent: the ghost headings, as before.
    chips?: boolean;
  }
> = ({
  searchInputProps,
  syntaxFilters,
  experiments,
  setSearchValue,
  allowDrafts = true,
  showStatusFilter = true,
  includeTempRollouts = false,
  defaultFilters,
  chips = false,
}) => {
  const {
    dropdownFilterOpen,
    setDropdownFilterOpen,
    project,
    projects,
    updateQuery,
    removeFieldFromSearch,
  } = useSearchFiltersBase({
    searchInputProps,
    syntaxFilters,
    setSearchValue,
  });

  // Shared source of truth for the filter taxonomy (see SidebarExperimentFilters).
  const {
    availableTags,
    metricItems,
    owners,
    resultItems,
    statusItems,
    typeItems,
    healthItems,
  } = useExperimentFilterCategories({
    experiments,
    allowDrafts,
    includeTempRollouts,
  });

  // chips: Add Filter's menu and each filter's menu styled as the column
  // menu (set in review): its shadow (.menuShadow) and rows (.menu).
  const menuClassName = chips
    ? `${listTableStyles.menuShadow} ${styles.menu}`
    : undefined;

  // Every filter, in the bar's order. Project only without a project
  // selected; Status only where it applies.
  const filters: { key: string; heading: string; node: ReactNode }[] = [
    ...(!project && projects.length > 0
      ? [
          {
            key: "project",
            heading: "Project",
            node: (
              <FilterDropdown
                chip={chips}
                menuClassName={menuClassName}
                filter="project"
                heading="Project"
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                items={projects.map((p) => {
                  return { name: p.name, id: p.id, searchValue: p.name };
                })}
                updateQuery={updateQuery}
              />
            ),
          },
        ]
      : []),
    {
      key: "metric",
      heading: "Metric",
      node: (
        <FilterDropdown
          chip={chips}
          menuClassName={menuClassName}
          filter="metric"
          heading="Metric"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={metricItems}
          updateQuery={updateQuery}
        />
      ),
    },
    {
      key: "owner",
      heading: "Owner",
      node: (
        <FilterDropdown
          chip={chips}
          menuClassName={menuClassName}
          filter="owner"
          heading="Owner"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={owners.map((o) => {
            return { name: o, id: o, searchValue: o };
          })}
          updateQuery={updateQuery}
        />
      ),
    },
    {
      key: "is",
      heading: "Result",
      node: (
        <FilterDropdown
          chip={chips}
          menuClassName={menuClassName}
          filter="is"
          heading="Result"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={resultItems}
          updateQuery={updateQuery}
        />
      ),
    },
    ...(showStatusFilter
      ? [
          {
            key: "status",
            heading: "Status",
            node: (
              <FilterDropdown
                chip={chips}
                menuClassName={menuClassName}
                filter="status"
                heading="Status"
                syntaxFilters={syntaxFilters}
                open={dropdownFilterOpen}
                setOpen={setDropdownFilterOpen}
                items={statusItems}
                updateQuery={updateQuery}
              />
            ),
          },
        ]
      : []),
    {
      key: "tag",
      heading: "Tag",
      node: (
        <FilterDropdown
          chip={chips}
          menuClassName={menuClassName}
          filter="tag"
          heading="Tag"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={availableTags.map((t) => {
            return {
              name: <Tag tag={t} key={t} skipMargin={true} variant="dot" />,
              id: t,
              searchValue: t,
            };
          })}
          updateQuery={updateQuery}
        />
      ),
    },
    {
      key: "has",
      heading: "Type",
      node: (
        <FilterDropdown
          chip={chips}
          menuClassName={menuClassName}
          filter="has"
          heading="Type"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={typeItems}
          updateQuery={updateQuery}
        />
      ),
    },
    {
      key: "health",
      heading: "Health",
      node: (
        <FilterDropdown
          chip={chips}
          menuClassName={menuClassName}
          filter="health"
          heading="Health"
          syntaxFilters={syntaxFilters}
          open={dropdownFilterOpen}
          setOpen={setDropdownFilterOpen}
          items={healthItems}
          updateQuery={updateQuery}
        />
      ),
    },
  ];

  // With defaultFilters (set in review; on the experiments list): those
  // always show, first, in the order given; the rest only once added from
  // "Add Filter", or while they're in use (e.g. from a shared link), so an
  // applied filter is never hidden. Without it, every filter shows, as
  // before.
  const [addedFilters, setAddedFilters] = useState<string[]>([]);
  const inUse = (key: string) => syntaxFilters.some((f) => f.field === key);
  const shown = defaultFilters
    ? [
        // Added filters newest first, at the front, before the defaults
        // (set in review; they followed the defaults), so a new one lands
        // next to Add Filter, where it shows, and everything else moves
        // along; the overflow takes from the end. Then the defaults, then
        // any others in use (e.g. from a shared link), in the bar's order.
        ...[...addedFilters]
          .reverse()
          .map((key) => filters.find((f) => f.key === key))
          .filter(
            (f): f is (typeof filters)[number] =>
              !!f && !defaultFilters.includes(f.key),
          ),
        ...defaultFilters
          .map((key) => filters.find((f) => f.key === key))
          .filter((f): f is (typeof filters)[number] => !!f),
        ...filters.filter(
          (f) =>
            !defaultFilters.includes(f.key) &&
            !addedFilters.includes(f.key) &&
            inUse(f.key),
        ),
      ]
    : filters;
  const addable = defaultFilters
    ? filters.filter((f) => !shown.some((s) => s.key === f.key))
    : [];
  // Set when a filter is chosen from "Add Filter", so the menu closing
  // leaves focus for that filter's own dropdown, opened straight after.
  const openAfterAdd = useRef<string | null>(null);

  // With chips, a remove button (set in review): on the filters beyond the
  // defaults, always, taking the filter off the bar and its values out of
  // the search; on the default ones, only while applied, clearing their
  // values (they stay on the bar).
  const isRemovable = (key: string) =>
    !!defaultFilters && (!defaultFilters.includes(key) || inUse(key));
  const removeFilters = (keys: string[]) => {
    const added = keys.filter((k) => !defaultFilters?.includes(k));
    if (added.length) {
      setAddedFilters((prev) => prev.filter((k) => !added.includes(k)));
    }
    removeFieldFromSearch(keys);
    if (keys.includes(dropdownFilterOpen)) setDropdownFilterOpen("");
  };
  const renderChip = (f: (typeof filters)[number]) =>
    isRemovable(f.key) &&
    React.isValidElement<{ onRemove?: () => void }>(f.node)
      ? React.cloneElement(f.node, { onRemove: () => removeFilters([f.key]) })
      : f.node;

  // chips: the overflow (set in review). The chips that don't fit before
  // the row's end (the table controls), 56px clear of them, fold into one
  // "+N" chip, from the last. Each chip's width is measured while it shows
  // and remembered while it's folded away.
  const rowRef = useRef<HTMLDivElement>(null);
  const addFilterRef = useRef<HTMLSpanElement>(null);
  const chipWidths = useRef(new Map<string, number>());
  const [visibleCount, setVisibleCount] = useState(shown.length);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!chips || !row) return;
    const compute = () => {
      row
        .querySelectorAll<HTMLElement>("[data-chip-key]")
        .forEach((el) =>
          chipWidths.current.set(el.dataset.chipKey ?? "", el.offsetWidth),
        );
      const gap = 8;
      const overflowWidth =
        chipWidths.current.get(OVERFLOW_KEY) ?? OVERFLOW_FALLBACK_WIDTH;
      const addWidth = addFilterRef.current
        ? addFilterRef.current.offsetWidth + gap
        : 0;
      // 44px spare, plus the toolbar's 12px gap: chips fold before they
      // come within 56px of the table controls (set in review; tried 28px
      // and 48px).
      const available = row.clientWidth - addWidth - 44;
      const widths = shown.map(
        (f) => chipWidths.current.get(f.key) ?? CHIP_FALLBACK_WIDTH,
      );
      const total = widths.reduce((sum, w) => sum + w + gap, 0) - gap;
      let count = shown.length;
      if (total > available) {
        let used = overflowWidth;
        count = 0;
        for (const w of widths) {
          if (used + gap + w > available) break;
          used += gap + w;
          count++;
        }
      }
      setVisibleCount((prev) => (prev === count ? prev : count));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    return () => observer.disconnect();
  });
  // chips: motion (set in review). Chips slide from where they were to
  // where they land, rather than jumping, when one's added, removed, gets
  // wider or narrower as filters apply, or the overflow folds and unfolds;
  // a chip that appears (or the "+N" chip) fades and scales in. Where each
  // chip is on screen is read here, before React updates the page (so mid-
  // slide, where it's drawn), and compared with where it lands below
  // (FLIP). A chip that goes away vanishes; the rest close up. Instant for
  // reduced motion.
  const chipRectsBefore = useRef(new Map<string, number>());
  const chipsMounted = useRef(false);
  if (chips && rowRef.current) {
    const before = new Map<string, number>();
    rowRef.current
      .querySelectorAll<HTMLElement>("[data-chip-key]")
      .forEach((el) =>
        before.set(el.dataset.chipKey ?? "", el.getBoundingClientRect().left),
      );
    chipRectsBefore.current = before;
  }
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!chips || !row) return;
    const before = chipRectsBefore.current;
    const firstRun = !chipsMounted.current;
    chipsMounted.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    row.querySelectorAll<HTMLElement>("[data-chip-key]").forEach((el) => {
      if (typeof el.animate !== "function") return;
      const key = el.dataset.chipKey ?? "";
      el.getAnimations().forEach((a) => a.cancel());
      const old = before.get(key);
      if (old === undefined) {
        if (firstRun) return;
        el.animate(
          [
            { opacity: 0, transform: "scale(0.92)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 200, easing: CHIP_EASE },
        );
        return;
      }
      const dx = old - el.getBoundingClientRect().left;
      if (Math.abs(dx) < 0.5) return;
      el.animate(
        [{ transform: `translateX(${dx}px)` }, { transform: "none" }],
        { duration: 240, easing: CHIP_EASE },
      );
    });
  });

  const fitCount = chips ? Math.min(visibleCount, shown.length) : shown.length;
  let visibleShown = shown.slice(0, fitCount);
  let hiddenShown = shown.slice(fitCount);
  // A safety net for a very narrow bar, where even the newest filter is
  // folded away: a chip whose menu is open shows, in the last visible place,
  // while it's open.
  const openHidden = hiddenShown.find((f) => f.key === dropdownFilterOpen);
  if (openHidden && visibleShown.length) {
    const bumped = visibleShown[visibleShown.length - 1];
    visibleShown = [...visibleShown.slice(0, -1), openHidden];
    hiddenShown = [bumped, ...hiddenShown.filter((f) => f !== openHidden)];
  } else if (openHidden) {
    visibleShown = [openHidden];
    hiddenShown = hiddenShown.filter((f) => f !== openHidden);
  }
  // The overflow chip's remove button removes the folded filters that can
  // be removed: added ones come off the bar; defaults (Status, Health) lose
  // their values but stay. It shows only when there's one of those, so it's
  // never a button that does nothing (e.g. with only unapplied defaults
  // folded away).
  const removableHidden = hiddenShown.filter((f) => isRemovable(f.key));
  const removeHidden = () => removeFilters(removableHidden.map((f) => f.key));

  // With defaultFilters, "Add Filter" leads and the filters follow it to
  // the right (set in review), so the bar grows away from the search field;
  // without it, the filters show as before.
  return (
    <Flex
      ref={rowRef}
      gap={chips ? "2" : "5"}
      align="center"
      className={chips ? styles.chips : undefined}
      // With chips, the row's remaining width, for the overflow.
      style={chips ? { flex: "1 1 0", minWidth: 0 } : undefined}
    >
      {addable.length > 0 ? (
        <span
          ref={addFilterRef}
          style={{ display: "inline-flex", flexShrink: 0 }}
        >
          <DropdownMenu
            trigger={
              // Ghost, as the Create Experiment modal's Cancel (set in
              // review; tried outline): --slate-12 text at 400
              // (.ghostButton), a soft grey fill on hover, no outline, 6px
              // corners. One size down, sm (24px).
              <Button
                variant="ghost"
                color="gray"
                size="sm"
                className={styles.ghostButton}
                // A funnel, the usual filter icon, regular weight (set in review; was a plus, then bold).
                icon={<PiFunnelSimple size={14} />}
                style={{
                  borderRadius: "var(--radius-3)",
                  color: "var(--slate-12)",
                }}
              >
                Add Filter
              </Button>
            }
            // With chips: lined up with the button's left edge, and 216px
            // wide, as the column menu (set in review).
            menuPlacement={chips ? "start" : "end"}
            menuWidth={chips ? 216 : undefined}
            contentClassName={menuClassName}
            onCloseAutoFocus={(e) => {
              const key = openAfterAdd.current;
              if (!key) return;
              e.preventDefault();
              openAfterAdd.current = null;
              setDropdownFilterOpen(key);
            }}
          >
            {chips ? <DropdownMenuLabel>Filter by</DropdownMenuLabel> : null}
            {addable.map((f) => (
              <DropdownMenuItem
                key={f.key}
                onClick={() => {
                  openAfterAdd.current = f.key;
                  setAddedFilters((prev) => [...prev, f.key]);
                }}
              >
                {f.heading}
              </DropdownMenuItem>
            ))}
          </DropdownMenu>
        </span>
      ) : null}
      {visibleShown.map((f) =>
        chips ? (
          // Measured for the overflow (data-chip-key), and kept at its
          // width.
          <span
            key={f.key}
            data-chip-key={f.key}
            style={{ display: "inline-flex", flexShrink: 0 }}
          >
            {renderChip(f)}
          </span>
        ) : (
          <Fragment key={f.key}>{f.node}</Fragment>
        ),
      )}
      {hiddenShown.length ? (
        // The overflow chip (set in review): "+N more" for the filters that don't
        // fit, a remove button that clears them all, and the filters
        // themselves, read-only, in a popover opened by clicking the chip
        // (set in review; it opened on hover). The chip is a button, so the
        // keyboard can open it too; the remove button sits beside it.
        <span
          data-chip-wrap
          data-chip-key={OVERFLOW_KEY}
          style={{
            position: "relative",
            display: "inline-flex",
            flexShrink: 0,
          }}
        >
          <Popover
            side="bottom"
            align="start"
            // .chips too, so its chips hover as the bar's (set in review):
            // the outline, and the remove button's darker ×.
            contentClassName={`${listTableStyles.menuShadow} ${styles.chips}`}
            contentStyle={{ padding: "var(--space-3)" }}
            trigger={
              <button
                type="button"
                data-filter-chip
                aria-label={`${hiddenShown.length} more filters`}
                style={{
                  display: "inline-flex",
                  padding: 0,
                  border: "none",
                  borderRadius: "var(--radius-full)",
                  background: "none",
                  cursor: "pointer",
                }}
              >
                <Badge
                  variant="soft"
                  color="gray"
                  radius="full"
                  size="md"
                  // As the chips' names: --slate-12 at 400 (set in
                  // review).
                  label={
                    <span style={{ color: "var(--slate-12)", fontWeight: 400 }}>
                      {`+${hiddenShown.length} more`}
                    </span>
                  }
                  style={
                    removableHidden.length ? { paddingRight: 26 } : undefined
                  }
                />
              </button>
            }
            content={
              <Flex direction="column" gap="2" align="start">
                {/* As the filter menus' headings: 12px at 500 in
                  --gray-12 (set in review). */}
                <span style={{ color: "var(--gray-12)" }}>
                  <Text size="sm" weight="medium">
                    More Filters
                  </Text>
                </span>
                {/* Each with its remove button where it has one on the
                  bar, to take them off one by one (set in review). */}
                {hiddenShown.map((f) =>
                  React.isValidElement<{
                    labelOnly?: boolean;
                    onRemove?: () => void;
                  }>(f.node) ? (
                    <Fragment key={f.key}>
                      {React.cloneElement(f.node, {
                        labelOnly: true,
                        onRemove: isRemovable(f.key)
                          ? () => removeFilters([f.key])
                          : undefined,
                      })}
                    </Fragment>
                  ) : null,
                )}
              </Flex>
            }
          />
          {removableHidden.length ? (
            <ChipRemoveButton
              label={`Remove ${removableHidden.length} more filters`}
              onClick={removeHidden}
            />
          ) : null}
        </span>
      ) : null}
    </Flex>
  );
};

export default ExperimentSearchFilters;
