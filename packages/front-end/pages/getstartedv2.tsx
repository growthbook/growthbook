import { useState, useEffect, useCallback } from "react";
import {
  Box,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Separator,
  Text,
} from "@radix-ui/themes";
import { PiArrowSquareOut, PiFlag } from "react-icons/pi";
import { ComputedExperimentInterface } from "back-end/types/experiment";
import { useFeature } from "@growthbook/growthbook-react";
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
import UpgradeModal from "@/components/Settings/UpgradeModal";
import { useGetStarted } from "@/services/GetStartedProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  AnalyzeExperimentFeatureCard,
  ExperimentFeatureCard,
  FeatureFlagFeatureCard,
  LaunchDarklyImportFeatureCard,
} from "@/components/GetStarted/FeaturedCards";
import DocumentationSidebar from "@/components/GetStarted/DocumentationSidebar";
import YouTubeLightBox from "@/components/GetStarted/YoutubeLightbox";
import OverviewCard from "@/components/GetStarted/OverviewCard";
import WorkspaceLinks from "@/components/GetStarted/WorkspaceLinks";
import Callout from "@/components/Radix/Callout";
import Link from "@/components/Radix/Link";
import useSDKConnections from "@/hooks/useSDKConnections";
import RadioCards from "@/components/Radix/RadioCards";
import Button from "@/components/Radix/Button";
import Avatar from "@/components/Radix/Avatar";
import { useAddComputedFields, useSearch } from "@/services/search";
import { useExperiments } from "@/hooks/useExperiments";
import { useExperimentSearch } from "@/services/experiments";
import {
  useEnvironments,
  useFeatureSearch,
  useFeaturesList,
} from "@/services/features";
import useApi from "@/hooks/useApi";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import { useUser } from "@/services/UserContext";
import DataSources from "@/components/Settings/DataSources";

type FeaturesAndRevisions = FeatureRevisionInterface & {
  feature: FeatureInterface;
  safeRollout: SafeRolloutInterface | undefined;
};

const GetStartedPage = (): React.ReactElement => {
  const [showVideoId, setShowVideoId] = useState<string>("");
  const [upgradeModal, setUpgradeModal] = useState<boolean>(false);
  const { clearStep } = useGetStarted();
  const { snapshot: snapshotWithResults } = useSafeRolloutSnapshot();

  const permissionsUtils = usePermissionsUtil();
  const { project } = useDefinitions();

  const canUseSetupFlow =
    permissionsUtils.canCreateSDKConnection({
      projects: [project],
      environment: "production",
    }) &&
    permissionsUtils.canCreateEnvironment({
      projects: [project],
      id: "production",
    });

  const { data: sdkConnectionData } = useSDKConnections();
  const showSetUpFlow =
    canUseSetupFlow &&
    sdkConnectionData &&
    !sdkConnectionData.connections.some((c) => c.connected);
  // fetch the experiments
  const { experiments } = useExperiments();
  const filterResults = useCallback(
    (items: ComputedExperimentInterface[]) => {
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
    },
    [experiments]
  );

  const { features } = useFeaturesList();
  const environments = useEnvironments();
  //   const getMostRecentFeatureUsageList = useCallback(() => {
  //     const featureUsageList = [];
  //     revisionsData?.revisions
  //       .filter((revision) => {
  //         if (
  //           (revision.createdBy?.type !== "api_key" &&
  //             revision.createdBy?.id === "user") ||
  //           (revision.publishedBy?.type !== "api_key" &&
  //             revision.publishedBy?.id === "user")
  //         ) {
  //           return true;
  //         }
  //         return false;
  //       })
  //       .sort((a, b) => {
  //         return (
  //           new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime()
  //         );
  //       })
  //       .slice(0, 5);
  //     experiments.filter((experiment) => {
  //       if(experiment.) {
  //     });
  //     return featureUsageList;
  //   }, [features, experiments]);
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
        }
        const isPendingReview = item.status === "pending-review";
        const isArchived = item.feature.archived;
        const safeRolloutRequiresAttention =
          safeRolloutDecisionStatus?.status === "unhealthy";
        return (isPendingReview || safeRolloutRequiresAttention) && !isArchived;
      });
    },
    [snapshotWithResults, organization?.settings, hasCommercialFeature]
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

  const getRecentlyUsedFeatures = useCallback(() => {
    let featureId: string | null = null;
    let experimentId: string | null = null;
    let datasourceId: string | null = null;
    let metricId: string | null = null;
    let attributeId: string | null = null;
    historyData?.events.filter((event) => {
      switch (event.entity?.object) {
        case "feature":
          if (!featureId) {
            featureId = event.entity.id;
          }
          break;
        case "experiment":
          if (!experimentId) {
            experimentId = event.entity.id;
          }
          break;
        case "datasource":
          if (!datasourceId) {
            datasourceId = event.entity.id;
          }
          break;
        case "metric":
          if (!metricId) {
            metricId = event.entity.id;
          }
          break;
        case "attribute":
          if (!attributeId) {
            attributeId = event.entity.id;
          }
          break;
        case "urlRedirect":
        default:
          break;
      }
    });
    return { featureId, experimentId, datasourceId, metricId, attributeId };
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

  // Also used for the `Launch Setup Flow`
  const DOCUMENTATION_SIDEBAR_WIDTH = "minmax(0, 245px)";
  const displayRecents = () => {
    const recentlyUsed = getRecentlyUsedFeatures();

    const recentFeatures = Object.entries(recentlyUsed)
      .filter(([_, id]) => id !== null)
      .map(([key, id]) => {
        const label = key
          .replace("Id", "")
          .replace(/([A-Z])/g, " $1")
          .trim()
          .replace(/^./, (str) => str.toUpperCase());

        // Determine the URL based on the type
        let url = "";
        switch (key) {
          case "featureId":
            url = `/features/${id}`;
            break;
          case "experimentId":
            url = `/experiment/${id}`;
            break;
          case "datasourceId":
            url = `/datasources/${id}`;
            break;
          case "metricId":
            url = `/metric/${id}`;
            break;
          case "attributeId":
            url = `/dimensions/${id}`;
            break;
        }

        return {
          label,
          value: key.toLowerCase().replace("id", ""),
          id,
          avatar: key === "featureId" ? <PiFlag /> : <PiArrowSquareOut />,
          url,
        };
      });

    return (
      <Container>
        <Text size="1" weight="bold">
          RECENTS
        </Text>
        <Flex direction="row" gap="3">
          {recentFeatures.map((feature) => (
            <RadioCards
              key={feature.value}
              align="center"
              options={[
                {
                  value: feature.value,
                  label: feature.label,
                  avatar: <Avatar>{feature.avatar}</Avatar>,
                },
              ]}
              value={""} // don't want a default value
              setValue={() => {}}
              onClick={() => {
                window.location.href = feature.url;
              }}
            />
          ))}
        </Flex>
      </Container>
    );
  };
  const displayExperimentsRequiringAttention = () => {
    return (
      <Container>
        <Text size="1" weight="bold">
          EXPERIMENTS REQUIRING ATTENTION{" "}
          <div className="badge bg-red-500">
            {experimentsNeedingAttention.length}
          </div>
        </Text>
        <table className="table experiment-table gbtable">
          <thead>
            <SortableTHExperiments field="id">Id</SortableTHExperiments>
            <SortableTHExperiments field="name">Name</SortableTHExperiments>
            <SortableTHExperiments field="status">Status</SortableTHExperiments>
          </thead>
          <tbody>
            {experimentsNeedingAttention.map(
              (item: ComputedExperimentInterface) => (
                <tr
                  key={item.id}
                  onClick={() => {
                    window.location.href = `/experiment/${item.id}`;
                  }}
                >
                  <td>{item.id}</td>
                  <td>{item.name}</td>
                  <td>{`${item?.statusIndicator?.detailedStatus}:  ${item.status}`}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </Container>
    );
  };

  const displayFeatureFlagsRequiringAttention = () => {
    return (
      <Container>
        <Text size="1" weight="bold">
          FEATURE FLAGS REQUIRING ATTENTION{" "}
          <div className="badge bg-red-500">
            {featureFlagsNeedingAttention.length}
          </div>
        </Text>
        <table className="table experiment-table gbtable">
          <thead>
            <SortableTHFeatureFlags field="featureId">
              Id
            </SortableTHFeatureFlags>
            <SortableTHFeatureFlags field="feature">
              Feature
            </SortableTHFeatureFlags>
            <SortableTHFeatureFlags field="status">
              Status
            </SortableTHFeatureFlags>
          </thead>
          <tbody>
            {featureFlagsNeedingAttention.map((item) => (
              <tr
                key={item.featureId}
                onClick={() => {
                  window.location.href = `/features/${item.featureId}`;
                }}
              >
                <td>{item.featureId}</td>
                <td>{item.feature.id}</td>
                <td>{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Container>
    );
  };

  return (
    <>
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(false)}
          source="get-started"
          commercialFeature={null}
        />
      )}
      {showVideoId && (
        <YouTubeLightBox
          close={() => setShowVideoId("")}
          videoId={showVideoId}
        />
      )}

      <Container
        px={{ initial: "2", xs: "4", sm: "7" }}
        py={{ initial: "1", xs: "3", sm: "6" }}
      >
        {displayRecents()}
        {displayExperimentsRequiringAttention()}
        {displayFeatureFlagsRequiringAttention()}
      </Container>
    </>
  );
};

export default GetStartedPage;
