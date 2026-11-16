import React, { useEffect, useRef } from "react";
import escapeRegExp from "lodash/escapeRegExp";
import { Box, Flex } from "@radix-ui/themes";
import { hasFileConfig, isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import useURLHash from "@/hooks/useURLHash";
import OrganizationAndLicenseSettings from "@/components/GeneralSettings/OrganizationAndLicenseSettings";
import ImportSettings from "@/components/GeneralSettings/ImportSettings";
import NorthStarMetricSettings from "@/components/GeneralSettings/NorthStarMetricSettings";
import ExperimentSettings from "@/components/GeneralSettings/ExperimentSettings";
import StatsEngineSettings from "@/components/GeneralSettings/ExperimentSettings/StatsEngineSettings";
import { SettingsGroup } from "@/components/GeneralSettings/SettingsGroup";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MetricsSettings from "@/components/GeneralSettings/MetricsSettings";
import FeatureSettings from "@/components/GeneralSettings/FeatureSettings";
import RampScheduleTemplates from "@/components/GeneralSettings/RampScheduleTemplates";
import DatasourceSettings from "@/components/GeneralSettings/DatasourceSettings";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import LearningSettings from "@/components/GeneralSettings/LearningSettings";
import AISettings from "@/components/GeneralSettings/AISettings";
import {
  resolveSettingsHash,
  scrollToSettingsSection,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "@/components/GeneralSettings/settingsSections";
import { useSettingsForm } from "@/components/GeneralSettings/SettingsFormProvider";
import SettingsSection from "@/components/GeneralSettings/SettingsSection";
import UnsavedChangesBar from "@/components/GeneralSettings/UnsavedChangesBar";
import CustomMarkdownSettings from "@/components/GeneralSettings/CustomMarkdownSettings";
import { useSettingsNav } from "@/components/Layout/SettingsNavContext";
import SettingsPage from "@/components/Layout/SettingsPage";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import sectionStyles from "@/components/GeneralSettings/SettingsSection.module.scss";
import SavedGroupSettings from "@/components/GeneralSettings/SavedGroupSettings";
import TargetingAttributesSettings from "@/components/GeneralSettings/TargetingAttributesSettings";
import ApprovalFlowSettings from "@/components/GeneralSettings/ApprovalFlowSettings";
import SDKConnectionSettings from "@/components/GeneralSettings/SDKConnectionSettings";

const SEARCH_HIGHLIGHT_CSS =
  "::highlight(settings-search){background-color:var(--amber-a5)}";

// The user taking over the scroll, including dragging the scrollbar.
const USER_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

const GeneralSettingsPage = (): React.ReactElement => {
  const [urlHash] = useURLHash();
  const {
    query,
    setQuery,
    activeSection,
    setActiveSection,
    pinnedSection,
    pinSection,
    counts,
  } = useSettingsNav();
  const { settings, organization, refreshOrganization } = useUser();
  const { promptForm } = useSettingsForm();
  const pageRef = useRef<HTMLDivElement>(null);
  // Re-applies the hash scroll while cards above load, until the user takes over.
  useEffect(() => {
    const id = resolveSettingsHash(urlHash);
    const root = pageRef.current;
    if (!id || !root) return;
    // A linked section hidden by the search would never show, so the search gives way.
    if (document.getElementById(id)?.closest("[hidden]")) setQuery("");
    const section = SETTINGS_SECTIONS.find(
      (s) => s.id === id || document.getElementById(id)?.closest(`#${s.id}`),
    );
    if (section) pinSection(section.id);
    // Fires once on observe, then again whenever cards above finish loading.
    const observer = new ResizeObserver(() => scrollToSettingsSection(id));
    observer.observe(root);
    const stop = () => observer.disconnect();
    USER_EVENTS.forEach((e) =>
      window.addEventListener(e, stop, { once: true }),
    );
    return () => {
      stop();
      USER_EVENTS.forEach((e) => window.removeEventListener(e, stop));
    };
  }, [urlHash, pinSection, setQuery]);

  // Scroll spy: the last visible section whose top has passed the sticky header is active.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // A clicked or linked section stays active until the user scrolls themselves.
      if (pinnedSection.current) {
        setActiveSection(pinnedSection.current);
        return;
      }
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      let active = "";
      for (const { id } of SETTINGS_SECTIONS) {
        const el = document.getElementById(id);
        if (!el || el.hidden) continue;
        // A short last section never reaches the top, so the page bottom selects it.
        if (!active || atBottom || el.getBoundingClientRect().top <= 180)
          active = id;
      }
      if (active) setActiveSection(active);
    };
    const unpin = () => {
      pinnedSection.current = null;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    USER_EVENTS.forEach((e) =>
      window.addEventListener(e, unpin, { passive: true }),
    );
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      USER_EVENTS.forEach((e) => window.removeEventListener(e, unpin));
      window.cancelAnimationFrame(frame);
    };
  }, [query, counts, setActiveSection, pinnedSection]);

  // Browsers without the Highlight API skip this.
  useEffect(() => {
    if (!("highlights" in CSS)) return;
    // Matching the original text keeps offsets valid; lowercasing can change length (e.g. "İ").
    const patterns = tokenizeSettingsQuery(query).map(
      (token) => new RegExp(escapeRegExp(token), "gi"),
    );
    const ranges: Range[] = [];
    pageRef.current
      ?.querySelectorAll("[data-settings-card]")
      .forEach((card) => {
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? "";
          for (const pattern of patterns) {
            for (const match of text.matchAll(pattern)) {
              const range = new Range();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              ranges.push(range);
            }
          }
        }
      });
    CSS.highlights.set("settings-search", new Highlight(...ranges));
    return () => {
      CSS.highlights.delete("settings-search");
    };
  }, [query, counts]);

  const tokens = tokenizeSettingsQuery(query);
  const hasQuery = tokens.length > 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const matchedSections = Object.values(counts).filter((n) => n > 0).length;
  const activeTitle = SETTINGS_SECTIONS.find(
    (s) => s.id === activeSection,
  )?.title;

  return (
    <>
      <SettingsPage
        title="General Settings"
        description="Organization-wide defaults. Projects can override some of these."
        headerClassName={sectionStyles.wideHidden}
        breadcrumb={[
          { display: "General", href: "/settings" },
          ...(activeTitle ? [{ display: activeTitle }] : []),
        ]}
        contentClassName={sectionStyles.generalContent}
      >
        {/* Injected at runtime: Turbopack's CSS parser rejects ::highlight(). */}
        <style>{SEARCH_HIGHLIGHT_CSS}</style>
        <div ref={pageRef}>
          {hasQuery && total > 0 && (
            <Flex align="center" gap="3" mt="3" wrap="wrap">
              <Box flexGrow="1" aria-live="polite">
                <Text size="sm" color="text-mid">
                  {`${total} match${total === 1 ? "" : "es"} for "${query.trim()}" in ${matchedSections} section${matchedSections === 1 ? "" : "s"}.`}
                </Text>
              </Box>
              <Button variant="ghost" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </Flex>
          )}
          {hasQuery && total === 0 && (
            <Box className={sectionStyles.noResults} role="status">
              <Text as="p" size="lg" weight="semibold" mb="1">
                No settings match &quot;{query.trim()}&quot;
              </Text>
              <Text as="p" color="text-mid" mb="3">
                Search matches setting names, descriptions, and keywords. Try a
                broader term, like &quot;refresh&quot; or &quot;variance&quot;.
              </Text>
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </Box>
          )}

          <SettingsSection id="organization">
            <OrganizationAndLicenseSettings org={organization} />
          </SettingsSection>

          <SettingsSection id="experiments">
            <ExperimentSettings />
          </SettingsSection>

          <SettingsSection id="statistics">
            <StatsEngineSettings />
            <SettingsGroup
              id="an-bandits"
              title={
                <PremiumTooltip
                  commercialFeature="multi-armed-bandits"
                  premiumText="Bandits are a Pro feature"
                >
                  Bandits
                </PremiumTooltip>
              }
              description="Defaults for new Bandits. Each Bandit can override these."
              keywords="multi-armed bandit exploratory stage update cadence burn-in weights"
            >
              <BanditSettings page="org-settings" />
            </SettingsGroup>
            <SettingsGroup
              id="an-learnings"
              title="Learning Statuses"
              description="Statuses available on saved Learnings. Each Learning can have one, shown as a badge. New Learnings start with no status."
              keywords="learnings statuses badges"
            >
              <LearningSettings />
            </SettingsGroup>
          </SettingsSection>

          <SettingsSection id="metrics">
            <MetricsSettings />
            <DatasourceSettings />
            <NorthStarMetricSettings />
          </SettingsSection>

          <SettingsSection id="features">
            <FeatureSettings />
            <RampScheduleTemplates />
          </SettingsSection>

          <SettingsSection id="approvals">
            <ApprovalFlowSettings />
          </SettingsSection>

          <SettingsSection id="sdk">
            <SDKConnectionSettings />
            <SavedGroupSettings />
            <TargetingAttributesSettings />
          </SettingsSection>

          <SettingsSection id="ai">
            <AISettings promptForm={promptForm} />
          </SettingsSection>

          <SettingsSection id="import">
            <ImportSettings
              hasFileConfig={hasFileConfig()}
              isCloud={isCloud()}
              settings={settings}
              refreshOrg={refreshOrganization}
            />
          </SettingsSection>

          <SettingsSection id="markdown">
            <CustomMarkdownSettings />
          </SettingsSection>

          <div className={sectionStyles.spacer} />
        </div>
        <UnsavedChangesBar />
      </SettingsPage>
    </>
  );
};

export default GeneralSettingsPage;
