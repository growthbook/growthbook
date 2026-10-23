import React, { useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { hasFileConfig, isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import useURLHash from "@/hooks/useURLHash";
import OrganizationAndLicenseSettings from "@/components/GeneralSettings/OrganizationAndLicenseSettings";
import ImportSettings from "@/components/GeneralSettings/ImportSettings";
import NorthStarMetricSettings from "@/components/GeneralSettings/NorthStarMetricSettings";
import ExperimentSettings, {
  ExperimentAnalysisSettings,
} from "@/components/GeneralSettings/ExperimentSettings";
import MetricsSettings from "@/components/GeneralSettings/MetricsSettings";
import FeatureSettings from "@/components/GeneralSettings/FeatureSettings";
import RampScheduleTemplates from "@/components/GeneralSettings/RampScheduleTemplates";
import DatasourceSettings from "@/components/GeneralSettings/DatasourceSettings";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import LearningSettings from "@/components/GeneralSettings/LearningSettings";
import AISettings from "@/components/GeneralSettings/AISettings";
import {
  resolveSettingsHash,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "@/components/GeneralSettings/settingsSections";
import { useSettingsForm } from "@/components/GeneralSettings/SettingsFormProvider";
import SettingsSection, {
  SettingsCard,
} from "@/components/GeneralSettings/SettingsSection";
import CustomMarkdownSettings from "@/components/GeneralSettings/CustomMarkdownSettings";
import { useSettingsNav } from "@/components/Layout/SettingsNavContext";
import SettingsPage from "@/components/Layout/SettingsPage";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import sectionStyles from "@/components/GeneralSettings/SettingsSection.module.scss";
import SavedGroupSettings from "@/components/GeneralSettings/SavedGroupSettings";
import TargetingAttributesSettings from "@/components/GeneralSettings/TargetingAttributesSettings";
import ApprovalFlowSettings from "@/components/GeneralSettings/ApprovalFlowSettings";
import SDKConnectionSettings from "@/components/GeneralSettings/SDKConnectionSettings";

export const ConnectSettingsForm = ({ children }) => {
  const methods = useFormContext();
  return children({ ...methods });
};

const GeneralSettingsPage = (): React.ReactElement => {
  const [urlHash] = useURLHash();
  const { query, setQuery, activeSection, setActiveSection, counts } =
    useSettingsNav();
  const { settings, organization, refreshOrganization } = useUser();
  const { promptForm, cronString, updateCronString } = useSettingsForm();
  const pageRef = useRef<HTMLDivElement>(null);
  // `#section` or a legacy `#tab/element` hash scrolls to that element. Cards
  // above it keep loading for a moment, so the scroll is re-applied as the page
  // grows until the user takes over or 2s pass.
  useEffect(() => {
    const id = resolveSettingsHash(urlHash);
    const root = pageRef.current;
    if (!id || !root) return;
    const scrollTo = (behavior: ScrollBehavior) =>
      document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
    const frame = window.requestAnimationFrame(() => scrollTo("smooth"));
    const observer = new ResizeObserver(() => scrollTo("auto"));
    observer.observe(root);
    const stop = () => observer.disconnect();
    const timer = window.setTimeout(stop, 2000);
    const userEvents = ["wheel", "touchmove", "keydown"] as const;
    userEvents.forEach((e) => window.addEventListener(e, stop, { once: true }));
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      stop();
      userEvents.forEach((e) => window.removeEventListener(e, stop));
    };
  }, [urlHash]);

  // Scroll spy: the last visible section whose top has passed the sticky header is active.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
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
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [query, counts, setActiveSection]);

  // Highlights query tokens inside cards. Progressive: browsers without the Highlight API skip it.
  useEffect(() => {
    if (!("highlights" in CSS)) return;
    const tokens = tokenizeSettingsQuery(query);
    const ranges: Range[] = [];
    pageRef.current
      ?.querySelectorAll("[data-settings-card]")
      .forEach((card) => {
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.toLowerCase() ?? "";
          for (const token of tokens) {
            for (
              let i = text.indexOf(token);
              i !== -1;
              i = text.indexOf(token, i + token.length)
            ) {
              const range = new Range();
              range.setStart(node, i);
              range.setEnd(node, i + token.length);
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
        title="General settings"
        description="Organization-wide defaults. Projects can override some of these."
        breadcrumb={[
          { display: "Settings" },
          { display: "General", href: "/settings" },
          ...(activeTitle ? [{ display: activeTitle }] : []),
        ]}
      >
        <div ref={pageRef}>
          {hasQuery && (
            <Flex align="center" gap="3" mt="3" wrap="wrap">
              <Box flexGrow="1" aria-live="polite">
                <Text size="sm" color="text-mid">
                  {total === 0
                    ? `No settings match "${query.trim()}".`
                    : `${total} match${total === 1 ? "" : "es"} for "${query.trim()}" in ${matchedSections} section${matchedSections === 1 ? "" : "s"}.`}
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
            <SettingsCard
              id="organization"
              keywords="company name admin owner email license plan seats"
            >
              <OrganizationAndLicenseSettings
                org={organization}
                refreshOrg={refreshOrganization}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="experiments">
            <SettingsCard
              id="experiment-settings"
              keywords="launch checklist template tracking key regex naming refresh schedule cron sticky bucketing srm health exposure decision framework"
            >
              <ExperimentSettings
                cronString={cronString}
                updateCronString={updateCronString}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="statistics">
            <SettingsCard
              id="experiment-analysis"
              keywords="stats engine bayesian frequentist p-value significance cuped variance reduction sequential testing prior"
            >
              <ExperimentAnalysisSettings />
            </SettingsCard>
            <SettingsCard
              id="bandits"
              keywords="multi-armed bandit cadence burn-in"
            >
              <Frame mb="4">
                <BanditSettings page="org-settings" />
              </Frame>
            </SettingsCard>
            <SettingsCard id="learnings" keywords="learning statuses badges">
              <Frame mb="4">
                <LearningSettings />
              </Frame>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="metrics">
            <SettingsCard
              id="metric-settings"
              keywords="lookback history threshold sample size outlier mde currency revenue fact tables slices"
            >
              <MetricsSettings />
            </SettingsCard>
            <SettingsCard
              id="datasource-settings"
              keywords="warehouse default data source test query top values"
            >
              <DatasourceSettings />
            </SettingsCard>
            <SettingsCard
              id="north-star"
              keywords="home page kpi goals north star"
            >
              <NorthStarMetricSettings />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="features">
            <SettingsCard
              id="feature-settings"
              keywords="feature key naming regex project environment json configs schema drafts code references github gitlab"
            >
              <FeatureSettings />
            </SettingsCard>
            <SettingsCard
              id="ramp-schedules"
              keywords="rollout schedule gradual ramp templates"
            >
              <RampScheduleTemplates />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="approvals">
            <SettingsCard
              id="approval-flows"
              keywords="review publish approval rest api bypass rebase reverts targeting"
            >
              <ApprovalFlowSettings />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="sdk">
            <SettingsCard
              id="sdk-connections"
              keywords="sdk connection project scoping"
            >
              <SDKConnectionSettings />
            </SettingsCard>
            <SettingsCard
              id="saved-groups"
              keywords="saved group project scope payload size limit"
            >
              <SavedGroupSettings />
            </SettingsCard>
            <SettingsCard
              id="targeting-attributes"
              keywords="targeting attribute schema registered"
            >
              <TargetingAttributesSettings />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="ai">
            <SettingsCard
              id="ai-settings"
              keywords="ai llm openai anthropic prompts assistant skills embeddings provider api key"
            >
              <AISettings promptForm={promptForm} />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="import">
            <SettingsCard
              id="import-export"
              keywords="yaml config export import backup migrate launchdarkly optimizely"
            >
              <ImportSettings
                hasFileConfig={hasFileConfig()}
                isCloud={isCloud()}
                settings={settings}
                refreshOrg={refreshOrganization}
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection id="markdown">
            <SettingsCard
              id="custom-markdown"
              keywords="guidance documentation help markdown"
            >
              <CustomMarkdownSettings />
            </SettingsCard>
          </SettingsSection>

          <div className={sectionStyles.spacer} />
        </div>
      </SettingsPage>
    </>
  );
};

export default GeneralSettingsPage;
