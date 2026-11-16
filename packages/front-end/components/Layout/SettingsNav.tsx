import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import { PiMagnifyingGlass, PiX } from "react-icons/pi";
import { IconButton } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import { TextField } from "@/ui/TextField";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  matchesSettingsQuery,
  ORG_PAGE_KEYWORDS,
  scrollToSettingsSection,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "@/components/GeneralSettings/settingsSections";
import { useSettingsForm } from "@/components/GeneralSettings/SettingsFormProvider";
import sectionStyles from "@/components/GeneralSettings/SettingsSection.module.scss";
import { buildSidebarLinkFilterProps } from "./SidebarLink";
import { settingsNavLink } from "./sidebarNav";
import { useSettingsNav } from "./SettingsNavContext";
import styles from "./SettingsNav.module.scss";

export default function SettingsNav() {
  const router = useRouter();
  const { query, setQuery, activeSection, counts, searchRef, pinSection } =
    useSettingsNav();
  const { dirtySectionIds } = useSettingsForm();
  const { permissions, superAdmin } = useUser();
  const { project, segments } = useDefinitions();
  const permissionsUtils = usePermissionsUtil();
  const gb = useGrowthBook<AppFeatures>();

  const filterProps = buildSidebarLinkFilterProps({
    permissionsUtils,
    permissions,
    superAdmin,
    gb,
    project,
    segments,
  });
  const onGeneral = router.route === "/settings";
  const showGeneral = permissionsUtils.canManageOrgSettings();
  const path = router.route.substr(1);
  const tokens = tokenizeSettingsQuery(query);
  const hasQuery = tokens.length > 0;

  const sections = SETTINGS_SECTIONS.filter(
    (s) => !hasQuery || (counts[s.id] ?? 0) > 0,
  );
  const pages = (settingsNavLink.subLinks ?? []).filter(
    (l) =>
      l.href !== "/settings" &&
      (!l.filter || l.filter(filterProps)) &&
      (!hasQuery ||
        matchesSettingsQuery(
          `${l.name} ${ORG_PAGE_KEYWORDS[l.href] ?? ""}`,
          tokens,
        )),
  );

  // One sub-nav item is current. A listed page wins; otherwise the importer
  // pages fall back to Import & Export, which links to them.
  const activePage = pages.find((l) => l.path.test(path));
  const fallbackSection =
    !activePage && /^importing/.test(path) ? "import" : null;

  const cardTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  const matchedSections = Object.values(counts).filter((n) => n > 0).length;
  const total = cardTotal + pages.length;
  const where = [
    matchedSections &&
      `${matchedSections} section${matchedSections === 1 ? "" : "s"}`,
    pages.length && `${pages.length} page${pages.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const resultText = !total
    ? "No matches"
    : `${total} match${total === 1 ? "" : "es"} in ${where.join(" and ")}`;

  // Cmd/Ctrl+/ focuses this search; Cmd/Ctrl+K stays on the command palette.
  const [shortcutHint, setShortcutHint] = useState("");
  useEffect(() => {
    setShortcutHint(/Mac/.test(navigator.platform) ? "⌘" : "Ctrl");
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchRef]);

  const onQueryChange = (q: string) => {
    setQuery(q);
    // Matches live on the General page, so typing elsewhere goes there.
    if (q.trim() && !onGeneral && showGeneral) router.push("/settings");
  };

  return (
    <aside className={styles.nav} aria-label="Settings navigation">
      <div className={styles.header}>
        <Heading as="h2" size="2xl" mb="0">
          Settings
        </Heading>
      </div>
      <TextField
        ref={searchRef}
        type="search"
        size="md"
        mx="3"
        mt="0"
        mb="2"
        aria-label="Search settings"
        placeholder="Search settings"
        prepend={<PiMagnifyingGlass aria-hidden="true" />}
        append={
          !query ? (
            <kbd
              className={styles.kbd}
              title={`${shortcutHint} / to search settings`}
              aria-label={`${shortcutHint} slash`}
            >
              <span>{shortcutHint}</span>
              <span>/</span>
            </kbd>
          ) : (
            <IconButton
              type="button"
              variant="ghost"
              color="gray"
              size="1"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <PiX />
            </IconButton>
          )
        }
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
        }}
      />
      {hasQuery && (
        <div className={styles.resultText} aria-live="polite">
          {resultText}
        </div>
      )}
      <div className={styles.scroll}>
        {showGeneral && (
          <nav aria-label="General settings sections" className={styles.group}>
            <div className={styles.groupLabel}>General</div>
            {sections.map((s) => {
              const active = onGeneral
                ? s.id === activeSection
                : s.id === fallbackSection;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={clsx(styles.item, { [styles.active]: active })}
                  aria-current={active ? "location" : undefined}
                  onClick={() => {
                    if (!onGeneral) {
                      router.push(`/settings#${s.id}`);
                      return;
                    }
                    pinSection(s.id);
                    scrollToSettingsSection(s.id);
                    // Keeps the hash shareable; scroll: false leaves the jump alone.
                    router.replace(`/settings#${s.id}`, undefined, {
                      shallow: true,
                      scroll: false,
                    });
                  }}
                >
                  <span className={styles.itemLabel}>{s.title}</span>
                  {dirtySectionIds.includes(s.id) && (
                    <span
                      className={sectionStyles.unsavedDot}
                      role="img"
                      aria-label="Unsaved changes"
                    />
                  )}
                  {hasQuery && (
                    <Badge
                      color="gray"
                      variant="soft"
                      radius="full"
                      label={String(counts[s.id] ?? 0)}
                    />
                  )}
                </button>
              );
            })}
            {hasQuery && !sections.length && (
              <div className={styles.empty}>No sections match.</div>
            )}
          </nav>
        )}
        {pages.length > 0 && (
          <nav aria-label="Organization settings" className={styles.group}>
            <div className={styles.groupLabel}>Organization</div>
            {pages.map((l) => {
              const active = l === activePage;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={clsx(styles.item, { [styles.active]: active })}
                  aria-current={active ? "page" : undefined}
                >
                  <span className={styles.itemLabel}>{l.name}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}
