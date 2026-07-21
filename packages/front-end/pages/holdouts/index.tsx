import React, { useEffect, useMemo, useRef, useState } from "react";
import { date, datetime } from "shared/dates";
import { startCase } from "lodash";
import { Box, Flex } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import NewHoldoutForm from "@/components/Holdout/NewHoldoutForm";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useHoldouts } from "@/hooks/useHoldouts";
import EmptyState from "@/components/EmptyState";
import LinkButton from "@/ui/LinkButton";
import { AttributeBadge } from "@/components/Features/AttributeBadge";
import Callout from "@/ui/Callout";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import useURLHash from "@/hooks/useURLHash";
import Link from "@/ui/Link";

const HOLDOUT_TABS = [
  "all",
  "running",
  "draft",
  "stopped",
  "archived",
] as const;
type HoldoutTab = (typeof HOLDOUT_TABS)[number];
const isHoldoutTab = (v: string): v is HoldoutTab =>
  HOLDOUT_TABS.includes(v as HoldoutTab);

const HoldoutsPage = (): React.ReactElement => {
  const { ready, project, projects } = useDefinitions();

  const initialHashRef = useRef(
    globalThis?.window ? window.location.hash.slice(1) : "",
  );
  const hasInitialValidHash = isHoldoutTab(initialHashRef.current);
  const [urlTab, setTab] = useURLHash<HoldoutTab>(HOLDOUT_TABS);
  const tab: HoldoutTab = urlTab && isHoldoutTab(urlTab) ? urlTab : "all";
  const [storedTab, setStoredTab] = useLocalStorage<HoldoutTab>(
    "holdouts-list-tab",
    "all",
  );
  const [didInitializeTab, setDidInitializeTab] = useState(false);
  const activeTab: HoldoutTab =
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

  const { getOwnerDisplay } = useUser();

  const {
    holdouts,
    experiments: allExperiments,
    experimentsMap,
    hasArchived,
    error,
    loading,
    mutateHoldouts,
  } = useHoldouts(project, activeTab === "archived");

  const [openNewHoldoutModal, setOpenNewHoldoutModal] = useState(false);

  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const holdoutsWithExperiment = useMemo(() => {
    return holdouts
      .map((holdout) => ({
        ...holdout,
        experiment: experimentsMap.get(holdout.experimentId),
      }))
      .filter(
        (
          item,
        ): item is typeof item & {
          experiment: NonNullable<typeof item.experiment>;
        } => !!item.experiment,
      );
  }, [holdouts, experimentsMap]);

  const holdoutItems = useAddComputedFields(holdoutsWithExperiment, (item) => {
    const durationString =
      item.experiment?.status === "draft"
        ? "--"
        : item.experiment?.status === "running"
          ? `${date(item.experiment.phases[0].dateStarted ?? "")} - now`
          : item.experiment?.status === "stopped"
            ? `${date(item.experiment.phases[0].dateStarted ?? "")} - ${date(
                item.experiment.phases[0].dateEnded ?? "",
              )}`
            : null;
    const projectsComputed = item.projects.reduce((acc, p) => {
      const proj = projects.find((project) => project.id === p);
      if (!proj) return acc;
      return [...acc, proj.name];
    }, []);
    const statusString =
      startCase(item.experiment.status) +
      (item.experiment.status === "running" &&
      item.experiment.phases.length === 2
        ? ": Analysis Phase"
        : "");
    const ownerName = getOwnerDisplay(item.experiment.owner);
    return {
      name: item.name,
      projects: projectsComputed,
      tags: item.experiment.tags,
      duration: durationString,
      numExperiments: Object.values(item.linkedExperiments).length || "--",
      numFeatures: Object.values(item.linkedFeatures).length || "--",
      ownerName,
      hashAttribute: item.experiment.hashAttribute,
      status: item.experiment.status,
      holdoutStatus: statusString,
    };
  });

  const { items, searchInputProps, isFiltered, SortableTableColumnHeader } =
    useSearch({
      items: holdoutItems,
      searchFields: [
        "name",
        "projects",
        "ownerName",
        "hashAttribute",
        "holdoutStatus",
      ],
      localStorageKey: "holdout-search",
      defaultSortField: "dateCreated",
      defaultSortDir: -1,
    });

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      counts[item.status] = counts[item.status] || 0;
      counts[item.status]++;
    });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    return activeTab !== "all"
      ? items.filter((item) => item.status === activeTab)
      : items;
  }, [activeTab, items]);

  const hasHoldoutFeature = hasCommercialFeature("holdouts");

  if (error) {
    return (
      <Callout status="error" mb="3">
        An error occurred: {error.message}
      </Callout>
    );
  }
  if (loading || !ready) {
    return <LoadingOverlay />;
  }

  const hasHoldoutsCreated = holdouts.length > 0 && allExperiments.length > 0;
  const canAdd = permissionsUtil.canViewHoldoutModal(project, projects);

  if (!hasHoldoutFeature) {
    return (
      <Box className="contents container-fluid pagecontents">
        <PremiumEmptyState
          h1="Holdouts"
          title="Measure aggregate impact with Holdouts"
          description="Holdouts allow you to measure the aggregate impact of features and experiments."
          commercialFeature="holdouts"
          learnMoreLink="https://docs.growthbook.io/app/holdouts"
        />
      </Box>
    );
  }

  return (
    <>
      <Box className="contents container-fluid pagecontents" mb="3" mt="2">
        <Flex mb="3" mt="2" align="center" justify="between">
          <h1 style={{ margin: 0 }}>Holdouts</h1>
          {canAdd && (
            <PremiumTooltip tipPosition="left" commercialFeature="holdouts">
              <Button
                onClick={() => setOpenNewHoldoutModal(true)}
                disabled={!hasHoldoutFeature}
              >
                Add Holdout
              </Button>
            </PremiumTooltip>
          )}
        </Flex>

        {!hasHoldoutsCreated ? (
          <EmptyState
            title="Measure aggregate impact with Holdouts"
            description="Measure the aggregate impact of features and experiments with Holdouts."
            leftButton={
              <LinkButton
                href="https://docs.growthbook.io/app/holdouts"
                variant="outline"
                external={true}
              >
                View docs
              </LinkButton>
            }
            rightButton={
              canAdd ? (
                <PremiumTooltip
                  tipPosition="left"
                  popperStyle={{ top: 15 }}
                  commercialFeature="holdouts"
                >
                  <Button
                    onClick={() => setOpenNewHoldoutModal(true)}
                    disabled={!hasHoldoutFeature}
                  >
                    Add Holdout
                  </Button>
                </PremiumTooltip>
              ) : null
            }
          />
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              if (isHoldoutTab(value)) setTab(value);
            }}
          >
            <Box mb="3">
              <TabsList>
                <TabsTrigger value="all">All Holdouts</TabsTrigger>
                {(["running", "draft", "stopped", "archived"] as const).map(
                  (tabValue) => {
                    if (tabValue === "archived" && !hasArchived) return null;
                    return (
                      <TabsTrigger value={tabValue} key={tabValue}>
                        {tabValue.slice(0, 1).toUpperCase()}
                        {tabValue.slice(1)}
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
            <Box mb="4" style={{ width: "40%" }}>
              <Field
                placeholder="Search..."
                type="search"
                {...searchInputProps}
              />
            </Box>
            <TabsContent value={activeTab}>
              <Table variant="list" stickyHeader roundedCorners>
                <TableHeader>
                  <TableRow>
                    <SortableTableColumnHeader field="name">
                      Holdout Name
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="projects">
                      Projects
                    </SortableTableColumnHeader>
                    <TableColumnHeader>Tags</TableColumnHeader>
                    <SortableTableColumnHeader field="ownerName">
                      Owner
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="hashAttribute">
                      ID Type
                    </SortableTableColumnHeader>
                    <TableColumnHeader>Experiments</TableColumnHeader>
                    <TableColumnHeader>Features</TableColumnHeader>
                    <SortableTableColumnHeader field="holdoutStatus">
                      Status
                    </SortableTableColumnHeader>
                    <SortableTableColumnHeader field="duration">
                      Duration
                    </SortableTableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((holdout) => (
                    <TableRow key={holdout.id}>
                      <TableCell style={{ padding: "var(--space-0)" }}>
                        <Link
                          href={`/holdout/${holdout.id}`}
                          style={{
                            display: "block",
                            padding: "var(--space-3)",
                            color: "var(--gray-12)",
                          }}
                        >
                          <span className="testname">{holdout.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        {holdout.projects.length === 0
                          ? null
                          : holdout.projects.join(", ")}
                      </TableCell>
                      <TableCell>
                        <SortedTags
                          tags={Object.values(holdout?.tags || [])}
                          useFlex={true}
                        />
                      </TableCell>
                      <TableCell>{holdout.ownerName}</TableCell>
                      <TableCell>
                        <AttributeBadge attributeId={holdout.hashAttribute} />
                      </TableCell>
                      <TableCell>{holdout.numExperiments}</TableCell>
                      <TableCell>{holdout.numFeatures}</TableCell>
                      <TableCell>{holdout.holdoutStatus}</TableCell>
                      <TableCell
                        title={datetime(
                          holdout.experiment.phases[0].dateStarted ?? "",
                        )}
                      >
                        {holdout.duration}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} style={{ textAlign: "center" }}>
                        {isFiltered
                          ? "No holdouts match the current filter."
                          : "No holdouts found."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        )}
      </Box>
      {openNewHoldoutModal && (
        <NewHoldoutForm
          onClose={() => setOpenNewHoldoutModal(false)}
          source="holdouts-list"
          isNewHoldout
          mutate={mutateHoldouts}
        />
      )}
    </>
  );
};

export default HoldoutsPage;
