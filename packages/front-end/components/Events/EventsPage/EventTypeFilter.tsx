import React, { useLayoutEffect, useRef, useState } from "react";
import { NotificationEventName } from "shared/types/events/event";
import { PiCaretDown, PiMagnifyingGlass, PiX } from "react-icons/pi";
import { notificationEventNames } from "@/components/EventWebHooks/utils";
import { capitalizeFirstLetter } from "@/services/utils";
import { Popover } from "@/ui/Popover";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import styles from "./EventTypeFilter.module.scss";

const GAP = 6;

const AREA_LABELS: Record<string, string> = {
  apiKey: "API Keys",
  config: "Configs",
  constant: "Constants",
  experiment: "Experiments",
  feature: "Feature Flags",
  holdout: "Holdouts",
  savedGroup: "Saved Groups",
  sdkConnection: "SDK Connections",
  user: "Users",
  webhook: "Webhooks",
};

// Grouped by the first segment, e.g. feature.* under Feature Flags.
const GROUPS = Object.entries(
  notificationEventNames.reduce<Record<string, NotificationEventName[]>>(
    (groups, name) => {
      (groups[name.split(".")[0]] ??= []).push(name);
      return groups;
    },
    {},
  ),
).map(([area, names]) => ({
  area,
  label: AREA_LABELS[area] ?? capitalizeFirstLetter(area),
  names,
}));

export default function EventTypeFilter({
  value,
  setValue,
}: {
  value: NotificationEventName[];
  setValue: (value: NotificationEventName[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    names: g.label.toLowerCase().includes(q)
      ? g.names
      : g.names.filter((n) => n.toLowerCase().includes(q)),
  })).filter((g) => g.names.length);
  const fieldRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(value.length);

  // Shows as many pills as fit, leaving room for "+N more".
  useLayoutEffect(() => {
    const box = pillsRef.current;
    const ghost = ghostRef.current;
    if (!box || !ghost) return;
    const update = () => {
      const widths = [...ghost.children].map(
        (c) => (c as HTMLElement).offsetWidth,
      );
      const more = widths.pop() ?? 0;
      let used = 0;
      let n = 0;
      while (n < widths.length) {
        const reserve = n + 1 < widths.length ? GAP + more : 0;
        if (used + widths[n] + reserve > box.clientWidth) break;
        used += widths[n] + GAP;
        n++;
      }
      setFit(Math.max(1, n));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [value]);
  const selected = new Set(value);
  const toggle = (names: NotificationEventName[], on: boolean) =>
    setValue(
      on
        ? [...value, ...names.filter((n) => !selected.has(n))]
        : value.filter((n) => !names.includes(n)),
    );

  const field = (
    <div
      ref={fieldRef}
      className={styles.field}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(!open);
      }}
    >
      {value.length ? (
        <div ref={pillsRef} className={styles.pills}>
          <div ref={ghostRef} className={styles.ghost} aria-hidden>
            {value.map((name) => (
              <span key={name} className={styles.pill}>
                <span>{name}</span>
                <span className={styles.iconButton}>
                  <PiX size={12} />
                </span>
              </span>
            ))}
            <span className={styles.more}>+{value.length} more</span>
          </div>
          {value.slice(0, fit).map((name) => (
            <span key={name} className={styles.pill}>
              <span>{name}</span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={`Remove ${name}`}
                onClick={() => toggle([name], false)}
              >
                <PiX size={12} />
              </button>
            </span>
          ))}
          {value.length > fit && (
            <button
              type="button"
              className={styles.more}
              onClick={() => setOpen(true)}
            >
              +{value.length - fit} more
            </button>
          )}
        </div>
      ) : (
        <span className={styles.placeholder} onClick={() => setOpen(!open)}>
          All event types
        </span>
      )}
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Choose event types"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <PiCaretDown size={14} />
      </button>
    </div>
  );

  return (
    <Popover
      anchorOnly
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      trigger={field}
      align="start"
      side="bottom"
      sideOffset={4}
      showArrow={false}
      contentStyle={{ padding: 0, width: 420 }}
      contentClassName={styles.panel}
      // Clicks on the field toggle it themselves.
      onInteractOutside={(e) => {
        if (fieldRef.current?.contains(e.target as Node)) e.preventDefault();
      }}
      content={
        <>
          <div className={styles.header}>
            <Text weight="medium" color="text-mid">
              Event type
            </Text>
            {value.length > 0 && (
              <Link onClick={() => setValue([])}>Clear</Link>
            )}
          </div>
          <div className={styles.search}>
            <TextField
              autoFocus
              type="search"
              aria-label="Search event types"
              placeholder="Search event types"
              prepend={<PiMagnifyingGlass aria-hidden />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.list}>
            {!groups.length && (
              <div className={styles.row}>
                <Text color="text-mid">No event types match.</Text>
              </div>
            )}
            {groups.map((g) => {
              const count = g.names.filter((n) => selected.has(n)).length;
              return (
                <React.Fragment key={g.area}>
                  <div className={styles.row}>
                    <Checkbox
                      label={g.label}
                      weight="bold"
                      value={
                        count === g.names.length
                          ? true
                          : count
                            ? "indeterminate"
                            : false
                      }
                      setValue={() => toggle(g.names, count !== g.names.length)}
                    />
                  </div>
                  {g.names.map((name) => (
                    <div key={name} className={`${styles.row} ${styles.child}`}>
                      <Checkbox
                        label={<span className={styles.mono}>{name}</span>}
                        weight="regular"
                        value={selected.has(name)}
                        setValue={(on) => toggle([name], on)}
                      />
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        </>
      }
    />
  );
}
