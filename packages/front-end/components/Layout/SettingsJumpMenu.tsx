import { useRef, useState } from "react";
import { useRouter } from "next/router";
import { VisuallyHidden } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import Heading from "@/ui/Heading";
import useMediaQuery from "@/hooks/useMediaQuery";
import { Popover } from "@/ui/Popover";
import { SETTINGS_SECTIONS } from "@/components/GeneralSettings/settingsSections";
import {
  SettingsNavBody,
  useSettingsPages,
  useSettingsSearchShortcut,
} from "./SettingsNav";
import { useSettingsNav } from "./SettingsNavContext";
import { SETTINGS_NAV_MIN_WIDTH_PX } from "./constants";
import styles from "./SettingsJumpMenu.module.scss";

/** Where the page is, as the Settings nav marks it. */
function useSettingsLocation(): string {
  const router = useRouter();
  const { activeSection } = useSettingsNav();
  const page = useSettingsPages().find((l) =>
    l.path.test(router.route.substring(1)),
  );
  if (page) return `Organization · ${page.name}`;
  // The importer pages belong to Import & Export, which links to them.
  const sectionId =
    router.route === "/settings"
      ? activeSection
      : router.route.startsWith("/importing")
        ? "import"
        : null;
  const section = SETTINGS_SECTIONS.find((s) => s.id === sectionId);
  return section ? `General · ${section.title}` : "Settings";
}

/**
 * The Settings nav below SETTINGS_NAV_MIN_WIDTH_PX: a button that opens it
 * over the page (SettingsPageTop).
 */
export default function SettingsJumpMenu() {
  const [open, setOpen] = useState(false);
  const location = useSettingsLocation();
  const { searchRef } = useSettingsNav();
  const menuRef = useRef<HTMLDivElement>(null);
  // Opened by the search shortcut: focus goes to the search field.
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
      // Not the search field, which would raise a phone's keyboard: the
      // current item, so the list opens scrolled to it.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        const menu = menuRef.current;
        if (toSearch.current) {
          toSearch.current = false;
          searchRef.current?.focus();
          return;
        }
        (
          menu?.querySelector<HTMLElement>("[aria-current]") ??
          menu?.querySelector<HTMLElement>("nav button, nav a")
        )?.focus();
      }}
      trigger={
        <button
          type="button"
          id="settings-jump-menu"
          className={styles.trigger}
        >
          <span className={styles.label}>
            <VisuallyHidden>Settings: </VisuallyHidden>
            {location}
          </span>
          <PiCaretDownBold size={12} aria-hidden="true" />
        </button>
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

/**
 * Below SETTINGS_NAV_MIN_WIDTH_PX, the top of every Settings page, in the
 * order the nav has beside it from there: the "Settings" title, then the
 * nav, as a select the width of the page's content. The select stays pinned
 * under the header as the page scrolls.
 */
export function SettingsPageTop() {
  const narrow = useMediaQuery(
    `(max-width: ${SETTINGS_NAV_MIN_WIDTH_PX - 1}px)`,
  );
  if (!narrow) return null;
  return (
    <>
      {/* Seen, not heard: the page's own h1 heads it (an h2 here would come
          first, and larger), and the menu's name starts with "Settings". */}
      <div aria-hidden="true">
        <Heading as="h2" size="2xl" mb="2">
          Settings
        </Heading>
      </div>
      <div className={styles.pinned}>
        <SettingsJumpMenu />
      </div>
    </>
  );
}
