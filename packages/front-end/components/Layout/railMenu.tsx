import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { PiArrowLeft, PiCaretRightBold } from "react-icons/pi";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import styles from "./RailMenu.module.scss";

// The side nav's menus (the profile menu and Help; set in review), written
// once as a list of entries, so the desktop popover and the narrow drawer's
// in-place menu show the same items with the same actions and can't drift
// apart. Above 1180px, DropdownEntries draws them in the popover, as
// before; below it, InPlaceMenu draws them in the drawer, in place of the
// nav.
export type RailMenuEntry =
  // A menu item: its content and what choosing it does.
  | {
      type: "item";
      key: string;
      content: ReactNode;
      onSelect: () => void;
      className?: string;
    }
  | { type: "separator"; key: string }
  // Anything else in the menu, as is (a header, the organization selector).
  | { type: "node"; key: string; node: ReactNode }
  // A submenu (Theme): a popover beside the menu on desktop, its own view
  // in the drawer, with Back to the menu.
  | {
      type: "submenu";
      key: string;
      label: string;
      trigger: ReactNode;
      entries: RailMenuEntry[];
      triggerClassName?: string;
      contentClassName?: string;
    };

// The drawer's in-place menu, while one is open (AppRail.tsx): where to
// draw it, and what Back and choosing an item do there.
export type RailMenuInPlace = {
  open: boolean;
  // Whether it was opened from the keyboard (its first item then shows its
  // focus ring).
  onOpen: (fromKeyboard: boolean) => void;
  onBack: (fromKeyboard: boolean) => void;
  // After an item's own action: closes the drawer, as picking a page does.
  onDone: () => void;
  // The drawer's element the menu is drawn in.
  host: HTMLElement | null;
  fromKeyboard: boolean;
};

// Desktop: the entries as the popover's items, as before.
export function DropdownEntries({
  entries,
  itemClassName,
}: {
  entries: RailMenuEntry[];
  itemClassName: string;
}) {
  return (
    <>
      {entries.map((entry) => {
        switch (entry.type) {
          case "item":
            return (
              <DropdownMenuItem
                key={entry.key}
                className={entry.className ?? itemClassName}
                onClick={entry.onSelect}
              >
                {entry.content}
              </DropdownMenuItem>
            );
          case "separator":
            return <DropdownMenuSeparator key={entry.key} />;
          case "node":
            return <Fragment key={entry.key}>{entry.node}</Fragment>;
          case "submenu":
            return (
              <DropdownSubMenu
                key={entry.key}
                triggerClassName={entry.triggerClassName ?? itemClassName}
                contentClassName={entry.contentClassName}
                trigger={entry.trigger}
              >
                <DropdownEntries
                  entries={entry.entries}
                  itemClassName={itemClassName}
                />
              </DropdownSubMenu>
            );
        }
      })}
    </>
  );
}

// The drawer (below 1180px): the entries in place of the nav, full width,
// under a Back row. A submenu opens as its own view, its Back returning to
// the menu; the menu's Back returns to the nav. Esc does the same as Back.
// Focus goes to the first item as a view opens, and back to a submenu's row
// on returning from it. Choosing an item does what it does on desktop, then
// closes the drawer.
export function InPlaceMenu({
  label,
  entries,
  itemClassName,
  inPlace,
}: {
  // The menu's name, for screen readers.
  label: string;
  entries: RailMenuEntry[];
  itemClassName: string;
  inPlace: RailMenuInPlace;
}) {
  // The open submenus, innermost last.
  const [stack, setStack] = useState<string[]>([]);
  // Where focus goes as the view changes: the first item, or (back from a
  // submenu) its row.
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
        className={clsx(itemClassName, styles.entry, styles.back)}
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
                className={clsx(entry.className ?? itemClassName, styles.entry)}
                onClick={() => {
                  entry.onSelect();
                  inPlace.onDone();
                }}
              >
                {entry.content}
              </button>
            );
          case "separator":
            return (
              <div key={entry.key} className={styles.separator} role="none" />
            );
          case "node":
            return <Fragment key={entry.key}>{entry.node}</Fragment>;
          case "submenu":
            return (
              <button
                key={entry.key}
                type="button"
                data-menu-entry={entry.key}
                className={clsx(
                  entry.triggerClassName ?? itemClassName,
                  styles.entry,
                )}
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
