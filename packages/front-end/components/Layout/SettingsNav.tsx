import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import { PiMagnifyingGlass } from "react-icons/pi";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import {
  matchesSettingsQuery,
  ORG_PAGE_KEYWORDS,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "@/components/GeneralSettings/settingsSections";
import { useSettingsForm } from "@/components/GeneralSettings/SettingsFormProvider";
import { buildSidebarLinkFilterProps } from "./SidebarLink";
import { settingsNavLink } from "./sidebarNav";
import { useSettingsNav } from "./SettingsNavContext";
import styles from "./SettingsNav.module.scss";

export function scrollToSettingsSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function SettingsNav() {
  const router = useRouter();
  const { query, setQuery, activeSection, counts, searchRef } =
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

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const matchedSections = Object.values(counts).filter((n) => n > 0).length;
  const resultText = !total
    ? "No matches"
    : `${total} match${total === 1 ? "" : "es"} in ${matchedSections} section${
        matchedSections === 1 ? "" : "s"
      }`;

  // "/" jumps to search from anywhere on a settings page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Only text entry keeps "/"; a focused checkbox or button still jumps.
      const typing =
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable ||
        (el instanceof HTMLInputElement &&
          !/^(checkbox|radio|button|submit)$/.test(el.type));
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [searchRef]);

  // Leaving settings drops the query so a return starts clean.
  useEffect(() => () => setQuery(""), [setQuery]);

  const onQueryChange = (q: string) => {
    setQuery(q);
    // Matches live on the General page, so typing elsewhere goes there.
    if (q.trim() && !onGeneral && showGeneral) router.push("/settings");
  };

  return (
    <aside className={styles.nav} aria-label="Settings navigation">
      <div className={styles.header}>Settings</div>
      <div className={styles.searchWrap}>
        <PiMagnifyingGlass className={styles.searchIcon} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          className={styles.search}
          aria-label="Search settings"
          placeholder="Search settings"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {!query && (
          <kbd className={styles.kbd} title="Press / to search settings">
            /
          </kbd>
        )}
      </div>
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
              const active = onGeneral && s.id === activeSection;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={clsx(styles.item, { [styles.active]: active })}
                  aria-current={active ? "location" : undefined}
                  onClick={() =>
                    onGeneral
                      ? scrollToSettingsSection(s.id)
                      : router.push(`/settings#${s.id}`)
                  }
                >
                  <span className={styles.itemLabel}>{s.title}</span>
                  {dirtySectionIds.includes(s.id) && (
                    <span
                      className={styles.dirtyDot}
                      role="img"
                      aria-label="Unsaved changes"
                    />
                  )}
                  {hasQuery && (
                    <span className={styles.count}>{counts[s.id]}</span>
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
              const active = l.path.test(path);
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
