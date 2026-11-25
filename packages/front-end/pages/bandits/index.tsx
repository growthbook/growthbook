import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { useExperiments } from "@/hooks/useExperiments";
import { useWatching } from "@/services/WatchProvider";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CustomMarkdown from "@/components/Markdown/CustomMarkdown";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import Button from "@/ui/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Tooltip from "@/components/Tooltip/Tooltip";
import LinkButton from "@/ui/LinkButton";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import Field from "@/components/Forms/Field";
import { useExperimentSearch } from "@/services/experiments";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import ExperimentsListTable from "@/components/Experiment/ExperimentsListTable";
import useURLHash from "@/hooks/useURLHash";

const BANDIT_LIST_TABS = [
  "all",
  "running",
  "drafts",
  "stopped",
  "archived",
] as const;
type BanditListTab = (typeof BANDIT_LIST_TABS)[number];
const isBanditListTab = (v: string): v is BanditListTab =>
  BANDIT_LIST_TABS.includes(v as BanditListTab);
const TAB_LABELS: Record<Exclude<BanditListTab, "all">, MessageDescriptor> = {
  running: msg`Running`,
  drafts: msg`Drafts`,
  stopped: msg`Stopped`,
  archived: msg`Archived`,
};

const ExperimentsPage = (): React.ReactElement => {
  const { t, i18n } = useLingui();
  const { ready, project, projects } = useDefinitions();

  const initialHashRef = useRef(
    globalThis?.window ? window.location.hash.slice(1) : "",
  );
  const hasInitialValidHash = isBanditListTab(initialHashRef.current);
  const [urlTab, setTab] = useURLHash<BanditListTab>(BANDIT_LIST_TABS);
  const tab: BanditListTab = urlTab && isBanditListTab(urlTab) ? urlTab : "all";
  const [storedTab, setStoredTab] = useLocalStorage<BanditListTab>(
    "bandits-list-tab",
    "all",
  );
  const [didInitializeTab, setDidInitializeTab] = useState(false);
  const activeTab: BanditListTab =
    !hasInitialValidHash && !didInitializeTab ? storedTab : tab;

  useEffect(() => {
    if (didInitializeTab) return;
    if (!hasInitialValidHash && storedTab !== tab) setTab(storedTab);
    setDidInitializeTab(true);
  }, [didInitializeTab, hasInitialValidHash, setTab, storedTab, tab]);

  useEffect(() => {
    if (!didInitializeTab) return;
    if (storedTab !== tab) setStoredTab(tab);
  }, [didInitializeTab, setStoredTab, storedTab, tab]);

  const {
    experiments: allExperiments,
    error,
    loading,
    hasArchived,
    tempRolloutExperimentIds,
  } = useExperiments(project, activeTab === "archived", "multi-armed-bandit", {
    includeTempRollouts: true,
  });

  const [openNewExperimentModal, setOpenNewExperimentModal] = useState(false);

  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const { watchedExperiments } = useWatching();

  const {
    items,
    searchInputProps,
    isFiltered,
    SortableTableColumnHeader,
    syntaxFilters,
    setSearchValue,
  } = useExperimentSearch({
    allExperiments,
    watchedExperimentIds: watchedExperiments,
    tempRolloutExperimentIds,
    localStorageKey: "bandits-page",
  });

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.tab] = counts[item.tab] || 0;
      counts[item.tab]++;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return activeTab !== "all"
      ? items.filter((item) => item.tab === activeTab)
      : items;
  }, [activeTab, items]);

  const hasMultiArmedBanditFeature = hasCommercialFeature(
    "multi-armed-bandits",
  );

  if (error) {
    const errorMessage = error.message;
    return (
      <Callout status="error" mb="3">
        <Trans>An error occurred: {errorMessage}</Trans>
      </Callout>
    );
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasExperiments = allExperiments.length > 0;

  const canAdd = permissionsUtil.canViewExperimentModal(project, projects);

  if (!hasMultiArmedBanditFeature) {
    return (
      <Box className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1={t`Bandits`}
          title={t`Run Adaptive Experiments with Bandits`}
          description={t`Bandits automatically guide more traffic to better variants.`}
          commercialFeature="multi-armed-bandits"
          learnMoreLink="https://docs.growthbook.io/bandits/overview"
        />
      </Box>
    );
  }

  return (
    <>
      <Box className="contents container-fluid pagecontents" mb="3" mt="2">
        <Flex
          className="filters md-form"
          mb="3"
          align="center"
          gap="3"
          wrap="wrap"
        >
          <Flex align="center">
            <h1>
              <Trans>Bandits</Trans>
            </h1>
          </Flex>
          <Box style={{ flex: 1 }} />
          <Box>
            <PremiumTooltip
              tipPosition="left"
              commercialFeature="multi-armed-bandits"
            >
              <Tooltip
                body={t`You don't have permission to add bandits in this project.`}
                shouldDisplay={hasMultiArmedBanditFeature && !canAdd}
              >
                <Button
                  onClick={() => {
                    setOpenNewExperimentModal(true);
                  }}
                  disabled={!hasMultiArmedBanditFeature || !canAdd}
                >
                  <Trans>Add Bandit</Trans>
                </Button>
              </Tooltip>
            </PremiumTooltip>
          </Box>
        </Flex>
        <CustomMarkdown page={"experimentList"} />
        {!hasExperiments ? (
          <Box className="box" py="5" style={{ textAlign: "center" }}>
            <Box style={{ maxWidth: 650, margin: "0 auto" }}>
              <h1>
                <Trans>Adaptively experiment with bandits.</Trans>
              </h1>
              <p className="">
                <Trans>Run adaptive experiments with Bandits.</Trans>
              </p>
            </Box>
            <Flex justify="center" pt="2" gap="3">
              <LinkButton
                href="/getstarted/experiment-guide"
                variant="outline"
                mr="4"
              >
                <Trans>Setup Instructions</Trans>
              </LinkButton>
              <PremiumTooltip
                tipPosition="left"
                popperStyle={{ top: 15 }}
                commercialFeature="multi-armed-bandits"
              >
                <Tooltip
                  body={t`You don't have permission to add bandits in this project.`}
                  shouldDisplay={hasMultiArmedBanditFeature && !canAdd}
                >
                  <Button
                    onClick={() => {
                      setOpenNewExperimentModal(true);
                    }}
                    disabled={!hasMultiArmedBanditFeature || !canAdd}
                  >
                    <Trans>Add Bandit</Trans>
                  </Button>
                </Tooltip>
              </PremiumTooltip>
            </Flex>
            <Box mt="5">
              <img
                src="/images/empty-states/bandits.png"
                alt={t`Bandits`}
                style={{ width: "100%", maxWidth: "740px", height: "auto" }}
              />
            </Box>
          </Box>
        ) : (
          <>
            <Tabs
              value={activeTab}
              onValueChange={(value) => {
                if (isBanditListTab(value)) setTab(value);
              }}
            >
              <Box mb="3">
                <TabsList>
                  <TabsTrigger value="all">
                    <Trans>All Bandits</Trans>
                  </TabsTrigger>
                  {(["running", "drafts", "stopped", "archived"] as const).map(
                    (tabValue) => {
                      if (tabValue === "archived" && !hasArchived) return null;
                      return (
                        <TabsTrigger value={tabValue} key={tabValue}>
                          {i18n._(TAB_LABELS[tabValue])}
                          {tabValue !== "archived" && (
                            <span
                              style={{
                                marginLeft: "var(--space-2)",
                                background: "var(--gray-3)",
                                border: "1px solid var(--gray-6)",
                                borderRadius: "var(--radius-2)",
                                padding: "0 var(--space-2)",
                                fontSize: "var(--font-size-1)",
                                color: "var(--gray-11)",
                              }}
                            >
                              {tabCounts[tabValue] || 0}
                            </span>
                          )}
                        </TabsTrigger>
                      );
                    },
                  )}
                </TabsList>
              </Box>
              <Flex gap="4" align="center" justify="between" mb="4" wrap="wrap">
                <Box flexBasis="300px" flexShrink="0">
                  <Field
                    size="legacy"
                    placeholder={t`Search...`}
                    type="search"
                    {...searchInputProps}
                  />
                </Box>
                <ExperimentSearchFilters
                  searchInputProps={searchInputProps}
                  syntaxFilters={syntaxFilters}
                  setSearchValue={setSearchValue}
                  experiments={allExperiments}
                  includeTempRollouts
                />
              </Flex>

              <TabsContent value={activeTab}>
                <ExperimentsListTable
                  tab={activeTab}
                  SortableTableColumnHeader={SortableTableColumnHeader}
                  filtered={filtered}
                  isFiltered={isFiltered}
                  project={project}
                  searchValue={searchInputProps.value}
                  setSearchValue={setSearchValue}
                  hrefBase="/bandit"
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </Box>
      {openNewExperimentModal && (
        <NewExperimentForm
          onClose={() => setOpenNewExperimentModal(false)}
          source="bandits-list"
          isNewExperiment={true}
          initialValue={{
            type: "multi-armed-bandit",
            statsEngine: "bayesian",
          }}
        />
      )}
    </>
  );
};

export default ExperimentsPage;
