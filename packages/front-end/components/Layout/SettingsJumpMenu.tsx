import { useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import { PiCaretDown } from "react-icons/pi";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import { Popover } from "@/ui/Popover";
import {
  SettingsNavBody,
  useCurrentSettingsItem,
  useSettingsSearchShortcut,
} from "./SettingsNav";
import { useSettingsNav } from "./SettingsNavContext";
import styles from "./SettingsJumpMenu.module.scss";

function useSettingsLocation(): string {
  const { page, section } = useCurrentSettingsItem();
  const { query } = useSettingsNav();
  const onGeneral = useRouter().route === "/settings";
  const location = page
    ? `Organization · ${page.name}`
    : section
      ? `General · ${section.title}`
      : "Settings";
  const search = query.trim();
  return onGeneral && search ? `${location} · matching “${search}”` : location;
}

function SettingsJumpMenu() {
  const [open, setOpen] = useState(false);
  const location = useSettingsLocation();
  const { query, searchRef } = useSettingsNav();
  const menuRef = useRef<HTMLDivElement>(null);
  const toSearch = useRef(false);
  useSettingsSearchShortcut(() => {
    if (open) {
      searchRef.current?.focus();
      return;
    }
    toSearch.current = true;
    setOpen(true);
  });

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="start"
      sideOffset={4}
      showArrow={false}
      contentClassName={styles.popover}
      contentStyle={{ padding: 0 }}
      // Radix would focus the search field, which raises a phone's keyboard.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        const search = toSearch.current;
        toSearch.current = false;
        // A frame later the popover has its height, so the list can scroll
        // the current item into view.
        requestAnimationFrame(() => {
          if (search) {
            searchRef.current?.focus();
            return;
          }
          const menu = menuRef.current;
          const item =
            menu?.querySelector<HTMLElement>("[aria-current]") ??
            menu?.querySelector<HTMLElement>("nav button, nav a");
          item?.focus({ preventScroll: true });
          item?.scrollIntoView({ block: "center" });
        });
      }}
      onEscapeKeyDown={(e) => {
        if (query && document.activeElement === searchRef.current) {
          e.preventDefault();
        }
      }}
      trigger={
        <Button
          variant="outline"
          color="gray"
          icon={<PiCaretDown />}
          iconPosition="right"
          truncate
          aria-label={`Settings: ${location}`}
          style={{ width: "100%", justifyContent: "space-between" }}
        >
          {location}
        </Button>
      }
      content={
        <div
          ref={menuRef}
          className={styles.menu}
          role="navigation"
          aria-label="Settings navigation"
        >
          <SettingsNavBody onNavigate={() => setOpen(false)} />
        </div>
      }
    />
  );
}

export function SettingsPageTop() {
  const { navMode } = useSettingsNav();
  const onGeneral = useRouter().route === "/settings";
  if (navMode !== "jumpMenu") return null;
  return (
    <>
      <div aria-hidden="true" className={styles.title}>
        <Heading as="h2" size="2xl" mb="2">
          Settings
        </Heading>
      </div>
      <div className={clsx(styles.pinned, onGeneral && styles.general)}>
        <SettingsJumpMenu />
      </div>
    </>
  );
}
