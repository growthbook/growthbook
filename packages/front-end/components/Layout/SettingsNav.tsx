import { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import clsx from "clsx";
import { PiMagnifyingGlass, PiX } from "react-icons/pi";
import { IconButton } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
import { buildSidebarLinkFilterProps, SidebarLinkProps } from "./SidebarLink";
import { settingsNavLink } from "./sidebarNav";
import { useSettingsNav } from "./SettingsNavContext";
import styles from "./SettingsNav.module.scss";

export function useSettingsPages(): SidebarLinkProps[] {
  const { permissions, superAdmin } = useUser();
  const { project, segments } = useDefinitions();
  const permissionsUtils = usePermissionsUtil();
  const gb = useGrowthBook();
  const filterProps = buildSidebarLinkFilterProps({
    permissionsUtils,
    permissions,
    superAdmin,
    gb,
    project,
    segments,
  });
  return (settingsNavLink.subLinks ?? []).filter(
    (l) => l.href !== "/settings" && (!l.filter || l.filter(filterProps)),
  );
}

function sectionIdForRoute(route: string, activeSection: string) {
  if (route === "/settings") return activeSection;
  if (route.startsWith("/importing")) return "import";
  return null;
}

export function useCurrentSettingsItem(): {
  page: SidebarLinkProps | null;
  section: (typeof SETTINGS_SECTIONS)[number] | null;
} {
  const { route } = useRouter();
  const { activeSection } = useSettingsNav();
  const page =
    useSettingsPages().find((l) => l.path.test(route.substring(1))) ?? null;
  const sectionId = page ? null : sectionIdForRoute(route, activeSection);
  return {
    page,
    section: SETTINGS_SECTIONS.find((s) => s.id === sectionId) ?? null,
  };
}

export function useSettingsSearchShortcut(onShortcut: () => void) {
  const onShortcutRef = useRef(onShortcut);
  onShortcutRef.current = onShortcut;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        onShortcutRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

export function SettingsNavBody({ onNavigate }: { onNavigate?: () => void }) {
  const { t, i18n } = useLingui();
  const router = useRouter();
  const { query, setQuery, counts, searchRef, pinSection } = useSettingsNav();
  const { dirtySectionIds } = useSettingsForm();
  const permissionsUtils = usePermissionsUtil();
  const current = useCurrentSettingsItem();
  const onGeneral = router.route === "/settings";
  const showGeneral = permissionsUtils.canManageOrgSettings();
  const tokens = tokenizeSettingsQuery(query);
  const hasQuery = tokens.length > 0;

  const sections = SETTINGS_SECTIONS.filter(
    (s) => !hasQuery || (counts[s.id] ?? 0) > 0,
  );
  const pages = useSettingsPages().filter(
    (l) =>
      !hasQuery ||
      matchesSettingsQuery(
        `${i18n._(l.name)} ${ORG_PAGE_KEYWORDS[l.href] ?? ""}`,
        tokens,
      ),
  );

  const cardTotal = Object.values(counts).reduce((a, b) => a + b, 0);
  const matchedSections = Object.values(counts).filter((n) => n > 0).length;
  const pageCount = pages.length;
  const total = cardTotal + pageCount;
  let resultText: ReactNode;
  if (!total) {
    resultText = <Trans>No matches</Trans>;
  } else if (matchedSections && pageCount) {
    resultText = (
      <Trans>
        <Plural value={total} one="# match" other="# matches" /> in{" "}
        <Plural value={matchedSections} one="# section" other="# sections" />{" "}
        and <Plural value={pageCount} one="# page" other="# pages" />
      </Trans>
    );
  } else if (matchedSections) {
    resultText = (
      <Trans>
        <Plural value={total} one="# match" other="# matches" /> in{" "}
        <Plural value={matchedSections} one="# section" other="# sections" />
      </Trans>
    );
  } else {
    resultText = (
      <Trans>
        <Plural value={total} one="# match" other="# matches" /> in{" "}
        <Plural value={pageCount} one="# page" other="# pages" />
      </Trans>
    );
  }

  const [shortcutHint, setShortcutHint] = useState("");
  useEffect(() => {
    setShortcutHint(/Mac/.test(navigator.platform) ? "⌘" : "Ctrl");
  }, []);

  const onQueryChange = (q: string) => {
    setQuery(q);
    // Matches live on the General page, so typing elsewhere goes there.
    if (q.trim() && !onGeneral && showGeneral) router.push("/settings");
  };

  return (
    <>
      <TextField
        ref={searchRef}
        type="search"
        size="md"
        mx="3"
        mt="0"
        mb="2"
        aria-label={t`Search settings`}
        placeholder={t`Search settings`}
        prepend={<PiMagnifyingGlass aria-hidden="true" />}
        append={
          !query ? (
            <kbd
              className={styles.kbd}
              title={t`${shortcutHint} / to search settings`}
              aria-label={t`${shortcutHint} slash`}
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
              aria-label={t`Clear search`}
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
          <nav
            aria-label={t`General settings sections`}
            className={styles.group}
          >
            <div className={styles.groupLabel}>
              <Trans>General</Trans>
            </div>
            {sections.map((s) => {
              const active = s.id === current.section?.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={clsx(styles.item, { [styles.active]: active })}
                  aria-current={active ? "location" : undefined}
                  onClick={() => {
                    onNavigate?.();
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
                      aria-label={t`Unsaved changes`}
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
              <div className={styles.empty}>
                <Trans>No sections match.</Trans>
              </div>
            )}
          </nav>
        )}
        {pages.length > 0 && (
          <nav aria-label={t`Organization settings`} className={styles.group}>
            <div className={styles.groupLabel}>
              <Trans>Organization</Trans>
            </div>
            {pages.map((l) => {
              const active = l === current.page;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={clsx(styles.item, { [styles.active]: active })}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <span className={styles.itemLabel}>{i18n._(l.name)}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </>
  );
}

export default function SettingsNav() {
  const { t } = useLingui();
  const { searchRef } = useSettingsNav();
  useSettingsSearchShortcut(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  });
  return (
    <aside className={styles.nav} aria-label={t`Settings navigation`}>
      <div className={styles.header}>
        <Heading as="h2" size="2xl" mb="0">
          <Trans>Settings</Trans>
        </Heading>
      </div>
      <SettingsNavBody />
    </aside>
  );
}
