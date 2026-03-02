import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getVariationsWithWeights } from "shared/experiments";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DEFAULT_DECISION_FRAMEWORK_ENABLED } from "shared/constants";
import { Flex } from "@radix-ui/themes";
import SRMCard from "@/components/HealthTab/SRMCard";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Button from "@/components/Button";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import { IssueTags, IssueValue } from "@/components/HealthTab/IssueTags";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import BanditSRMCard from "@/components/HealthTab/BanditSRMCard";
import Callout from "@/ui/Callout";
import { PowerCard } from "@/components/HealthTab/PowerCard";
import {
  HealthTabConfigParams,
  HealthTabOnboardingModal,
} from "./HealthTabOnboardingModal";

const noExposureQueryMessage =
  "The health tab only works when your experiment has an Exposure Assignment Table. On the Results tab, click Analysis Settings and ensure you have selected the correct Exposure Assignment Table.";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  onHealthNotify: () => void;
  onSnapshotUpdate: () => void;
  resetResultsSettings: () => void;
}

export default function HealthTab({
  experiment,
  onHealthNotify,
  onSnapshotUpdate,
  resetResultsSettings,
}: Props) {
  const {
    error,
    dimensionless: snapshot,
    phase,
    mutateSnapshot,
    setAnalysisSettings,
  } = useSnapshot();
  const { runHealthTrafficQuery, decisionFrameworkEnabled } = useOrgSettings();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );

  const hasPermissionToConfigHealthTag =
    (datasource &&
      permissionsUtil.canManageOrgSettings() &&
      permissionsUtil.canRunHealthQueries(datasource) &&
      permissionsUtil.canUpdateDataSourceSettings(datasource)) ||
    false;
  const [healthIssues, setHealthIssues] = useState<IssueValue[]>([]);
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";

  const healthTabConfigParams: HealthTabConfigParams = {
    experiment,
    phase,
    refreshOrganization,
    mutateSnapshot,
    setAnalysisSettings,
    setLoading,
    resetResultsSettings,
  };

  // Clean up notification counter & health issues before unmounting
  useEffect(() => {
    return () => {
      onSnapshotUpdate();
      setHealthIssues([]);
    };
  }, [experiment, snapshot, onSnapshotUpdate]);

  const handleHealthNotification = useCallback(
    (issue: IssueValue) => {
      setHealthIssues((prev) => {
        const issueSet: Set<IssueValue> = new Set([...prev, issue]);
        return [...issueSet];
      });
      onHealthNotify();
    },
    [onHealthNotify],
  );

  // If org has the health tab turned to off and has no data, prompt set up if the
  // datasource and exposure query are present
  if (
    !isBandit &&
    !runHealthTrafficQuery &&
    !snapshot?.health?.traffic.dimension?.dim_exposure_date
  ) {
    // If for some reason the datasource and exposure query are missing, then we should
    // not show the onboarding flow as there are other problems with this experiment
    if (!datasource || !exposureQuery) {
      return (
        <Callout status="info" mt="3">
          {noExposureQueryMessage}
        </Callout>
      );
    }
    return (
      <Callout status="info" mt="3" contentsAs="div">
        <Flex gap="4">
          {runHealthTrafficQuery === undefined
            ? "Welcome to the new health tab! You can use this tab to view experiment traffic over time, perform balance checks, and check for multiple exposures. To get started, "
            : "Health queries are disabled in your Organization Settings. To enable them and set up the health tab, "}
          {hasPermissionToConfigHealthTag ? (
            <>
              click the button on the right.
              <Button
                className="ml-2"
                style={{ width: "200px" }}
                onClick={async () => {
                  track("Health Tab Onboarding Opened", {
                    source: "health-tab",
                  });
                  setSetupModalOpen(true);
                }}
              >
                Set up Health Tab
              </Button>
              {setupModalOpen ? (
                <HealthTabOnboardingModal
                  open={setupModalOpen}
                  close={() => setSetupModalOpen(false)}
                  dataSource={datasource}
                  exposureQuery={exposureQuery}
                  healthTabOnboardingPurpose={"setup"}
                  healthTabConfigParams={healthTabConfigParams}
                />
              ) : null}
            </>
          ) : (
            "ask an admin in your organization to navigate to any experiment health tab and follow the onboarding process."
          )}
        </Flex>
      </Callout>
    );
  }

  if (error) {
    return (
      <Callout status="error" mt="3">
        {error.message}
      </Callout>
    );
  }

  if (snapshot?.health?.traffic.error === "TOO_MANY_ROWS") {
    return (
      <Callout status="error" mt="3">
        <div className="mb-2">
          Please update your{" "}
          <Link href={`/datasources/${experiment.datasource}`}>
            Datasource Settings
          </Link>{" "}
          to return fewer dimension slices per dimension or select fewer
          dimensions to use in traffic breakdowns.
        </div>

        <div>
          For more advice, see the documentation on the Health Tab{" "}
          <a href="https://docs.growthbook.io/app/experiment-results#adding-dimensions-to-health-tab">
            here
          </a>
          .
        </div>
      </Callout>
    );
  }

  if (snapshot?.health?.traffic.error === "NO_ROWS_IN_UNIT_QUERY") {
    return (
      <Callout status="info" mt="3">
        No data found. It is likely there are no units in your experiment yet.
      </Callout>
    );
  }

  if (snapshot?.health?.traffic.error) {
    return (
      <Callout status="info" mt="3">
        There was an error running the query for health tab:{" "}
        {snapshot?.health?.traffic.error}.
      </Callout>
    );
  }

  if (!snapshot?.health?.traffic.dimension?.dim_exposure_date) {
    if (loading) {
      return (
        <Callout status="info" mt="3">
          <LoadingSpinner /> Snapshot refreshing, health data loading...
        </Callout>
      );
    }
    if (!datasource || !exposureQuery) {
      return (
        <Callout status="info" mt="3">
          {noExposureQueryMessage} Then, next time you update results, the
          health tab will be available.
        </Callout>
      );
    }
    if (isBandit) {
      if (experiment.status === "draft") {
        return (
          <Callout status="info" mt="3">
            Start the Bandit to see health data.
          </Callout>
        );
      } else {
        return (
          <Callout status="info" mt="3">
            No updates yet. Traffic and health results will appear after a
            successful refresh of the results.
          </Callout>
        );
      }
    }
    return (
      <Callout status="info" mt="3">
        Please return to the results page and run a query to see health data.
      </Callout>
    );
  }

  const totalUsers = snapshot?.health?.traffic?.overall?.variationUnits?.reduce(
    (acc, a) => acc + a,
    0,
  );

  const traffic = snapshot.health.traffic;

  const phaseObj = experiment.phases?.[phase] ?? null;

  const variations = getVariationsWithWeights(phaseObj).map((v, i) => ({
    id: v.key || i + "",
    name: v.name,
    weight: v.weight,
  }));

  return (
    <div className="mt-2">
      <IssueTags issues={healthIssues} />
      <TrafficCard
        traffic={traffic}
        variations={variations}
        isBandit={isBandit}
      />
      <div id="balanceCheck" style={{ scrollMarginTop: "100px" }}>
        {!isBandit ? (
          <SRMCard
            traffic={traffic}
            variations={variations}
            totalUsers={totalUsers}
            onNotify={handleHealthNotification}
            dataSource={datasource}
            exposureQuery={exposureQuery}
            healthTabConfigParams={healthTabConfigParams}
            canConfigHealthTab={hasPermissionToConfigHealthTag}
          />
        ) : (
          <BanditSRMCard
            snapshot={snapshot}
            phase={phaseObj}
            onNotify={handleHealthNotification}
          />
        )}
      </div>

      <div className="row">
        <div
          className={!isBandit ? "col-8" : "col-12"}
          id="multipleExposures"
          style={{ scrollMarginTop: "100px" }}
        >
          <MultipleExposuresCard
            totalUsers={totalUsers}
            onNotify={handleHealthNotification}
            snapshot={snapshot}
          />
        </div>
      </div>

      {!isBandit &&
      !isHoldout &&
      (decisionFrameworkEnabled ?? DEFAULT_DECISION_FRAMEWORK_ENABLED) ? (
        <PowerCard
          experiment={experiment}
          snapshot={snapshot}
          onNotify={handleHealthNotification}
        />
      ) : null}
    </div>
  );
}
