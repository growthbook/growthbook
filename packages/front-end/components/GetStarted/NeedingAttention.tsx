import { useState, useCallback } from "react";
import { Container, Flex, Grid, Text } from "@radix-ui/themes";
import {
  PiFlag,
  PiFlagBold,
  PiFlaskBold,
  PiDatabaseBold,
  PiChartLineBold,
} from "react-icons/pi";
import { ComputedExperimentInterface } from "back-end/types/experiment";
import { FeatureInterface } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { EventUserLoggedIn } from "back-end/src/events/event-types";
import { SafeRolloutInterface } from "back-end/types/safe-rollout";
import {
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
  getHealthSettings,
} from "shared/enterprise";
import { AuditInterface } from "back-end/types/audit";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { Box } from "spectacle";
import { useDefinitions } from "@/services/DefinitionsContext";
import RadioCards from "@/components/Radix/RadioCards";
import Button from "@/components/Radix/Button";
import Avatar from "@/components/Radix/Avatar";
import Pagination from "@/components/Radix/Pagination";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useExperiments } from "@/hooks/useExperiments";
import { useExperimentSearch } from "@/services/experiments";
import { useFeaturesList } from "@/services/features";
import useApi from "@/hooks/useApi";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import { useUser } from "@/services/UserContext";
import Badge from "@/components/Radix/Badge";
import {
  ExperimentDot,
  ExperimentStatusDetailsWithDot,
} from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import UserAvatar from "@/components/Avatar/UserAvatar";

type FeaturesAndRevisions = FeatureRevisionInterface & {
  feature: FeatureInterface;
  safeRollout: SafeRolloutInterface | undefined;
};

const NeedingAttentionPage = (): React.ReactElement | null => {
  const [experimentsPage, setExperimentsPage] = useState<number>(1);
  const [featureFlagsPage, setFeatureFlagsPage] = useState(1);
  const { snapshot: snapshotWithResults } = useSafeRolloutSnapshot();
  const {
    getProjectById,
    getDatasourceById,
    getMetricById,
    getFactMetricById,
  } = useDefinitions();
  const { user } = useUser();

  // fetch the experiments
  const { experiments } = useExperiments();
  const filterResults = useCallback((items: ComputedExperimentInterface[]) => {
    // filter to only those experiments that match the status
    if (!items || !items.length) return [];
    items = items.filter((e) => {
      const isRunning = e.status === "running";
      const isArchived = e.archived;

      const currentPhase = e.phases[e.phases.length - 1];

      const hasNoData =
        e.statusIndicator?.detailedStatus &&
        e.statusIndicator?.detailedStatus === "No data" &&
        currentPhase.dateStarted &&
        new Date(currentPhase.dateStarted) <
          new Date(Date.now() - 1000 * 60 * 60 * 24 * 2); // 2 days ago

      return (
        e?.statusIndicator?.detailedStatus &&
        (e.statusIndicator?.detailedStatus === "unhealthy" ||
          e.statusIndicator?.detailedStatus === "warning" ||
          (hasNoData && isRunning && !isArchived))
      );
    });
    return items;
  }, []);

  const { features } = useFeaturesList();
  const { hasCommercialFeature, organization } = useUser();
  const {
    items: experimentsNeedingAttention,
    SortableTH: SortableTHExperiments,
  } = useExperimentSearch({
    allExperiments: experiments,
    defaultSortField: "id",
    localStorageKey: "experimentsNeedingAttention",
    filterResults,
  });
  const filterResultsFeatureFlags = useCallback(
    (items: FeaturesAndRevisions[]) => {
      return items.filter((item) => {
        let safeRolloutDecisionStatus;
        let hasDaysLeft = true;
        if (item.safeRollout) {
          const daysLeft = getSafeRolloutDaysLeft({
            safeRollout: item.safeRollout,
            snapshotWithResults,
          });
          const safeRolloutStatus = getSafeRolloutResultStatus({
            safeRollout: item.safeRollout,
            healthSettings: getHealthSettings(
              organization?.settings,
              hasCommercialFeature("decision-framework")
            ),
            daysLeft,
          });
          safeRolloutDecisionStatus = safeRolloutStatus;
          hasDaysLeft = daysLeft > 0;
        }
        const requiresReview = item.status === "pending-review";
        const inProgress =
          (item.status === "changes-requested" ||
            item.status === "approved" ||
            item.status === "draft") &&
          item.createdBy?.type === "dashboard" &&
          item.createdBy?.id === user?.id;
        const isArchived = item.feature.archived;
        const safeRolloutRequiresAttention =
          safeRolloutDecisionStatus?.status === "unhealthy" || !hasDaysLeft;
        return (
          (inProgress || requiresReview || safeRolloutRequiresAttention) &&
          !isArchived
        );
      });
    },
    [
      user?.id,
      snapshotWithResults,
      organization?.settings,
      hasCommercialFeature,
    ]
  );
  const { data: safeRolloutData } = useApi<{
    status: number;
    safeRollouts: SafeRolloutInterface[];
  }>(`/safe-rollout`);

  const safeRollouts = safeRolloutData?.safeRollouts;
  const draftAndReviewData = useApi<{
    status: number;
    revisions: FeatureRevisionInterface[];
  }>(`/revision/feature`);
  const { data: revisionsData } = draftAndReviewData;
  const { data: historyData } = useApi<{
    status: number;
    events: AuditInterface[];
  }>(`/user/history`);

  const getRecentlyUsedFeatures = useCallback((): {
    [key: string]: {
      type: string;
      id: string;
    };
  } => {
    const recentlyUsed = {};
    historyData?.events.filter((event) => {
      // break out if we get
      if (Object.keys(recentlyUsed).length >= 4) {
        return false;
      }
      if (!recentlyUsed[event.entity.id]) {
        switch (event.entity?.object) {
          case "feature":
            recentlyUsed[event.entity.id] = {
              type: "feature",
              id: event.entity.id,
            };
            break;
          case "experiment":
            recentlyUsed[event.entity.id] = {
              type: "experiment",
              id: event.entity.id,
            };
            break;
          case "datasource":
            recentlyUsed[event.entity.id] = {
              type: "datasource",
              id: event.entity.id,
            };
            break;
          case "metric":
            recentlyUsed[event.entity.id] = {
              type: "metric",
              id: event.entity.id,
            };
            break;
          case "attribute":
            recentlyUsed[event.entity.id] = {
              type: "attribute",
              id: event.entity.id,
            };
            break;
        }
      }
    });
    return recentlyUsed;
  }, [historyData]);

  const featuresAndRevisions = revisionsData?.revisions.reduce<
    FeaturesAndRevisions[]
  >((result, revision) => {
    const feature = features.find((f) => f.id === revision.featureId);
    if (feature && feature?.dateCreated <= revision.dateCreated) {
      result.push({
        ...revision,
        feature,
        safeRollout: safeRollouts?.find((sr) => sr.featureId === feature?.id),
      });
    }
    return result;
  }, []);

  const revisions = useAddComputedFields(featuresAndRevisions, (revision) => {
    const createdBy = revision?.createdBy as EventUserLoggedIn | null;
    let dateAndStatus = new Date(revision?.dateUpdated).getTime();
    switch (revision?.status) {
      case "draft":
        dateAndStatus = parseInt(`0${dateAndStatus}`);
        break;
      case "approved":
        dateAndStatus = parseInt(`0${dateAndStatus}`);
        break;
      case "pending-review":
        dateAndStatus = parseInt(`1${dateAndStatus}`);
        break;
      case "changes-requested":
        dateAndStatus = parseInt(`1${dateAndStatus}`);
        break;
    }
    return {
      id: revision.feature?.id,
      tags: revision.feature?.tags,
      status: revision?.status,
      version: revision?.version,
      dateCreated: revision?.dateCreated,
      dateUpdated: revision?.dateUpdated,
      project: revision.feature?.project,
      creator: createdBy?.name,
      comment: revision?.comment,
      dateAndStatus,
    };
  });
  const {
    items: featureFlagsNeedingAttention,
    SortableTH: SortableTHFeatureFlags,
  } = useSearch({
    items: revisions,
    localStorageKey: "featureFlagsNeedingAttention",
    defaultSortDir: -1,
    defaultSortField: "dateCreated",
    searchFields: ["featureId", "createdBy"],
    filterResults: filterResultsFeatureFlags,
  });

  const displayRecentUsedFeatures = () => {
    const recentlyUsed = getRecentlyUsedFeatures();
    const recentFeatures = Object.entries(recentlyUsed).map(
      ([key, { type, id }]) => {
        let label = type.charAt(0).toUpperCase() + type.slice(1);
        // Determine the URL based on the type
        let url = "";
        let avatar = <PiFlag />;
        switch (type) {
          case "feature":
            label = features.find((f) => f.id === id)?.id || label;
            url = `/features/${id}`;
            avatar = <PiFlagBold />;
            break;
          case "experiment":
            label = experiments.find((e) => e.id === id)?.name || label;
            url = `/experiment/${id}`;
            avatar = <PiFlaskBold />;
            break;
          case "datasource":
            label = getDatasourceById(id || "")?.name || label;
            url = `/datasources/${id}`;
            avatar = <PiDatabaseBold />;
            break;
          case "metric":
            label =
              getMetricById(id || "")?.name ||
              getFactMetricById(id || "")?.name ||
              label;
            url = `/metric/${id}`;
            avatar = <PiChartLineBold />;
            break;
        }

        return {
          label,
          value: key.toLowerCase().replace("id", ""),
          id,
          avatar,
          url,
        };
      }
    );

    return (
      <Container className="recent-items-container">
        <Text size="4" weight="medium" as="div">
          Recent
        </Text>
        <Grid
          columns={{
            initial: "1fr",
            sm: "minmax(0, 1fr) minmax(0, 1fr)",
            md: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
          }}
          gap="3"
          mt="3"
        >
          {recentFeatures.map((feature) => (
            <RadioCards
              key={feature.value}
              align="center"
              width="100%"
              labelSize="1"
              labelWeight="medium"
              options={[
                {
                  value: feature.value,
                  label: feature.label,
                  avatar: <Avatar variant="soft">{feature.avatar}</Avatar>,
                },
              ]}
              value={""} // don't want a default value
              setValue={() => {}}
              onClick={() => {
                window.location.href = feature.url;
              }}
            />
          ))}
        </Grid>
      </Container>
    );
  };
  const getAvatarAndName = (name: string) => {
    return (
      <Flex align="center" gap="2">
        <UserAvatar name={name} size="sm" variant="soft" />
        {name}
      </Flex>
    );
  };
  const displayExperimentsRequiringAttention = () => {
    const ITEMS_PER_PAGE = 5;
    const startIndex = (experimentsPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedExperiments = experimentsNeedingAttention.slice(
      startIndex,
      endIndex
    );

    return (
      <Container className="mt-5">
        <Flex direction="row" align="center">
          <Text size="4" weight="medium">
            Experiments requiring attention
          </Text>
          <Badge
            color="blue"
            variant="soft"
            radius="full"
            ml="2"
            label={experimentsNeedingAttention.length.toString()}
          />
        </Flex>
        {experimentsNeedingAttention.length > 0 ? (
          <table className="table gbtable needs-attentions-table mt-3">
            <thead>
              <tr>
                <SortableTHExperiments field="name">Name</SortableTHExperiments>
                <SortableTHExperiments field="project">
                  Project
                </SortableTHExperiments>
                <SortableTHExperiments field="id">Owner</SortableTHExperiments>
                <SortableTHExperiments field="status">
                  Status
                </SortableTHExperiments>
              </tr>
            </thead>
            <tbody>
              {paginatedExperiments.map((item: ComputedExperimentInterface) => (
                <tr
                  key={item.id}
                  className="cursor-pointer hover-highlight"
                  onClick={() => {
                    window.location.href = `/experiment/${item.id}`;
                  }}
                >
                  <td>{item.name}</td>
                  <td>{getProjectById(item?.project || "")?.name}</td>
                  <td className="text-nowrap">
                    {getAvatarAndName(item.ownerName)}
                  </td>
                  <td className="text-nowrap">
                    <ExperimentStatusDetailsWithDot
                      statusIndicatorData={item.statusIndicator}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Container mt="3" width="100%">
            <Flex direction="column">
              <Text>No experiments requiring attention</Text>
              <div>
                <Button
                  mt="2"
                  onClick={() => {
                    window.location.href = "/experiments";
                  }}
                >
                  View all experiments
                </Button>
              </div>
            </Flex>
          </Container>
        )}
        {experimentsNeedingAttention.length > ITEMS_PER_PAGE && (
          <Flex justify="start" mt="1">
            <Pagination
              numItemsTotal={experimentsNeedingAttention.length}
              perPage={ITEMS_PER_PAGE}
              currentPage={experimentsPage}
              onPageChange={(page) => setExperimentsPage(page)}
            />
          </Flex>
        )}
      </Container>
    );
  };
  const renderStatusCopy = (revision: FeatureRevisionInterface) => {
    switch (revision.status) {
      case "approved":
        return (
          <Flex gap="1" align="center">
            <ExperimentDot color="green" />
            Approved
          </Flex>
        );
      case "pending-review":
        return (
          <Flex gap="1" align="center">
            <ExperimentDot color="amber" />
            Pending Review
          </Flex>
        );
      case "draft":
        return <span className="mr-3">Draft</span>;
      case "changes-requested":
        return (
          <Flex gap="1" align="center">
            <ExperimentDot color="red" />
            Changes Requested
          </Flex>
        );
      default:
        return;
    }
  };

  const displayFeatureFlagsRequiringAttention = () => {
    const ITEMS_PER_PAGE = 5;
    const startIndex = (featureFlagsPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;

    const paginatedFeatureFlags = featureFlagsNeedingAttention.slice(
      startIndex,
      endIndex
    );
    return (
      <Container mt="6">
        <Flex direction="row" align="center">
          <Text size="4" weight="medium">
            Feature flags requiring attention
          </Text>
          <Badge
            color="blue"
            variant="soft"
            radius="full"
            ml="2"
            label={featureFlagsNeedingAttention.length.toString()}
          />
        </Flex>
        {featureFlagsNeedingAttention.length > 0 ? (
          <table className="table gbtable needs-attentions-table mt-3">
            <thead>
              <tr>
                <SortableTHFeatureFlags field="featureId">
                  Feature Key
                </SortableTHFeatureFlags>
                <SortableTHFeatureFlags field="feature">
                  Project
                </SortableTHFeatureFlags>
                <SortableTHFeatureFlags field="status">
                  Owner
                </SortableTHFeatureFlags>
                <SortableTHFeatureFlags field="status">
                  Status
                </SortableTHFeatureFlags>
              </tr>
            </thead>
            <tbody>
              {paginatedFeatureFlags.map((item) => (
                <tr
                  key={item.featureId}
                  onClick={() => {
                    window.location.href = `/features/${item.featureId}`;
                  }}
                  className="cursor-pointer hover-highlight"
                >
                  <td>{item.feature.id}</td>
                  <td>{getProjectById(item.feature?.project || "")?.name}</td>
                  <td>{getAvatarAndName(item.feature.owner)}</td>
                  <td>{renderStatusCopy(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Container mt="3" width="100%">
            <Flex direction="column">
              <Text>No feature flags requiring attention</Text>
              <div>
                <Button
                  mt="2"
                  onClick={() => {
                    window.location.href = "/feature-flags";
                  }}
                >
                  View all feature flags
                </Button>
              </div>
            </Flex>
          </Container>
        )}
        {featureFlagsNeedingAttention.length > ITEMS_PER_PAGE && (
          <Flex justify="start" mt="1">
            <Pagination
              numItemsTotal={featureFlagsNeedingAttention.length}
              perPage={ITEMS_PER_PAGE}
              currentPage={featureFlagsPage}
              onPageChange={setFeatureFlagsPage}
            />
          </Flex>
        )}
      </Container>
    );
  };
  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || ""
  );

  const hasFeatures = features.some((f) => f.project !== demoProjectId);
  const hasExperiments = experiments.some((e) => e.project !== demoProjectId);
  const orgIsUsingFeatureAndExperiment = hasFeatures || hasExperiments;
  return !orgIsUsingFeatureAndExperiment ? null : (
    <Box>
      {displayRecentUsedFeatures()}
      {displayExperimentsRequiringAttention()}
      {displayFeatureFlagsRequiringAttention()}
    </Box>
  );
};

export default NeedingAttentionPage;
