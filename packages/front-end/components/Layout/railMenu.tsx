import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { IconType } from "react-icons";
import clsx from "clsx";
import { PiArrowLeft, PiCaretRightBold } from "react-icons/pi";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import styles from "./RailMenu.module.scss";

// Written once, so the desktop popover and the drawer's in-place menu show
// the same items with the same actions.
export type RailMenuEntry =
  | {
      type: "item";
      key: string;
      content: ReactNode;
      onSelect: () => void;
      className?: string;
      // Stays open after it's chosen, e.g. to show a result in place.
      keepOpen?: boolean;
    }
  | { type: "separator"; key: string }
  | { type: "label"; key: string; label: string }
  // Anything else in the menu, as is (the organization picker).
  | { type: "node"; key: string; node: ReactNode }
  | {
      type: "submenu";
      key: string;
      label: string;
      trigger: ReactNode;
      entries: RailMenuEntry[];
    };

// 16px icons, as the design system's menus; 18px in the drawer, as the
// side nav's rows.
export function MenuItemContent({
  Icon,
  label,
  trailing,
}: {
  Icon: IconType;
  label: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <span className={styles.itemContent}>
      <Icon size={16} className={styles.itemIcon} aria-hidden="true" />
      <span className={styles.itemLabel}>{label}</span>
      {trailing}
    </span>
  );
}

export type RailMenuInPlace = {
  open: boolean;
  // Whether it was opened from the keyboard (its first item then shows its
  // focus ring).
  onOpen: (fromKeyboard: boolean) => void;
  onBack: (fromKeyboard: boolean) => void;
  // After an item's own action: closes the drawer, as picking a page does.
  onDone: () => void;
  host: HTMLElement | null;
  fromKeyboard: boolean;
};

export function DropdownEntries({ entries }: { entries: RailMenuEntry[] }) {
  return (
    <>
      {entries.map((entry) => {
        switch (entry.type) {
          case "item":
            return (
              <DropdownMenuItem
                key={entry.key}
                className={entry.className}
                onClick={(event) => {
                  // Radix closes the menu unless this is cancelled.
                  if (entry.keepOpen) event.preventDefault();
                  entry.onSelect();
                }}
              >
                {entry.content}
              </DropdownMenuItem>
            );
          case "separator":
            return <DropdownMenuSeparator key={entry.key} />;
          case "label":
            return (
              <DropdownMenuLabel key={entry.key}>
                {entry.label}
              </DropdownMenuLabel>
            );
          case "node":
            return <Fragment key={entry.key}>{entry.node}</Fragment>;
          case "submenu":
            return (
              <DropdownSubMenu key={entry.key} trigger={entry.trigger}>
                <DropdownEntries entries={entry.entries} />
              </DropdownSubMenu>
            );
        }
      })}
    </>
  );
}

// Focus goes to the first item as a view opens, and back to a submenu's
// row on returning from it.
export function InPlaceMenu({
  label,
  entries,
  inPlace,
  pinBack = false,
}: {
  label: string;
  entries: RailMenuEntry[];
  inPlace: RailMenuInPlace;
  // For a long list: Back stays at the top while it scrolls.
  pinBack?: boolean;
}) {
  const [stack, setStack] = useState<string[]>([]);
  const focusTarget = useRef<string | null>(null);
  const keyboard = useRef(inPlace.fromKeyboard);
  const ref = useRef<HTMLDivElement>(null);

  let view = entries;
  let viewLabel = label;
  for (const key of stack) {
    const sub = view.find(
      (e): e is Extract<RailMenuEntry, { type: "submenu" }> =>
        e.type === "submenu" && e.key === key,
    );
    if (!sub) break;
    view = sub.entries;
    viewLabel = sub.label;
  }

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const target = focusTarget.current
      ? root.querySelector<HTMLElement>(
          `[data-menu-entry="${focusTarget.current}"]`,
        )
      : root.querySelector<HTMLElement>("[data-menu-entry]");
    focusTarget.current = null;
    target?.focus({
      preventScroll: true,
      focusVisible: keyboard.current,
    } as FocusOptions);
  }, [stack]);

  const back = (fromKeyboard: boolean) => {
    keyboard.current = fromKeyboard;
    if (stack.length) {
      focusTarget.current = stack[stack.length - 1];
      setStack(stack.slice(0, -1));
    } else {
      inPlace.onBack(fromKeyboard);
    }
  };

  return (
    <div
      ref={ref}
      className={styles.inPlace}
      role="group"
      aria-label={viewLabel}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        back(true);
      }}
    >
      <button
        type="button"
        className={clsx(
          styles.entry,
          styles.back,
          pinBack && styles.backPinned,
        )}
        onClick={(e) => back(e.detail === 0)}
      >
        <span className={styles.backContent}>
          <PiArrowLeft size={18} className={styles.backIcon} aria-hidden />
          <span>Back</span>
        </span>
      </button>
      {view.map((entry) => {
        switch (entry.type) {
          case "item":
            return (
              <button
                key={entry.key}
                type="button"
                data-menu-entry={entry.key}
                className={clsx(styles.entry, entry.className)}
                onClick={() => {
                  entry.onSelect();
                  if (!entry.keepOpen) inPlace.onDone();
                }}
              >
                {entry.content}
              </button>
            );
          case "separator":
            return (
              <div key={entry.key} className={styles.separator} role="none" />
            );
          case "label":
            return (
              <div key={entry.key} className={styles.label} aria-hidden="true">
                {entry.label}
              </div>
            );
          case "node":
            return <Fragment key={entry.key}>{entry.node}</Fragment>;
          case "submenu":
            return (
              <button
                key={entry.key}
                type="button"
                data-menu-entry={entry.key}
                className={styles.entry}
                onClick={(e) => {
                  keyboard.current = e.detail === 0;
                  setStack([...stack, entry.key]);
                }}
              >
                {entry.trigger}
                <PiCaretRightBold
                  size={12}
                  className={styles.caret}
                  aria-hidden
                />
              </button>
            );
        }
      })}
    </div>
  );
}
