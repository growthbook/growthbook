import { Fragment, ReactNode } from "react";
import { IconType } from "react-icons";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import styles from "./RailMenu.module.scss";

// The side nav's menus (the profile menu and Help), written once as a list
// of entries, so every place a menu is drawn shows the same items with the
// same actions. DropdownEntries draws them in the design system's dropdown
// menu, with its own look.
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

// An item's content: its icon, its label and anything after it (a count,
// Theme's value). 16px icons, as the design system's menus.
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
