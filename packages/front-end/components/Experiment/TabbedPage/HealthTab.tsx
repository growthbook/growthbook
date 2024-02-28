import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SRMDrawer from "@/components/HealthTab/SRMDrawer";
import MultipleExposuresDrawer from "@/components/HealthTab/MultipleExposuresDrawer";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import useOrgSettings from "@/hooks/useOrgSettings";
import Button from "@/components/Button";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import { IssueTags, IssueValue } from "@/components/HealthTab/IssueTags";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import {
  HealthTabConfigParams,
  HealthTabOnboardingModal,
} from "./HealthTabOnboardingModal";

const noExposureQueryMessage =
  "The health tab only works when your experiment has an Exposure Assignment Table. On the Results tab, click Analysis Settings and ensure you have selected the correct Exposure Assignment Table.";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  onDrawerNotify: () => void;
  onSnapshotUpdate: () => void;
  resetResultsSettings: () => void;
}

export default function HealthTab({
  experiment,
  onDrawerNotify,
  onSnapshotUpdate,
  resetResultsSettings,
}: Props) {
  const {
    error,
    snapshot,
    phase,
    mutateSnapshot,
    setAnalysisSettings,
  } = useSnapshot();
  const { runHealthTrafficQuery } = useOrgSettings();
  const { refreshOrganization } = useUser();
  const permissions = usePermissions();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  );

  const hasPermissionToConfigHealthTag =
    permissions.check("organizationSettings") &&
    permissions.check("runQueries", datasource?.projects || []) &&
    permissions.check("editDatasourceSettings", datasource?.projects || []);
  const [healthIssues, setHealthIssues] = useState<IssueValue[]>([]);
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

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
  }, [snapshot, onSnapshotUpdate]);

  const handleDrawerNotify = useCallback(
    (issue: IssueValue) => {
      setHealthIssues((prev) => {
        const issueSet: Set<IssueValue> = new Set([...prev, issue]);
        return [...issueSet];
      });
      onDrawerNotify();
    },
    [onDrawerNotify]
  );

  // If org has the health tab turned to off and has no data, prompt set up if the
  // datasource and exposure query are present
  if (
    !runHealthTrafficQuery &&
    !snapshot?.health?.traffic.dimension?.dim_exposure_date
  ) {
    // If for some reason the datasource and exposure query are missing, then we should
    // not show the onboarding flow as there are other problems with this experiment
    if (!datasource || !exposureQuery) {
      return (
        <div className="alert alert-info mt-3 d-flex">
          {noExposureQueryMessage}
        </div>
      );
    }
    return (
      <div className="alert alert-info mt-3 d-flex">
        {runHealthTrafficQuery === undefined
          ? "Welcome to the new health tab! You can use this tab to view experiment traffic over time, perform balance checks, and check for multiple exposures. To get started, "
          : "Health queries are disabled in your Organization Settings. To enable them and set up the health tab, "}
        {hasPermissionToConfigHealthTag ? (
          <>
            click the button on the right.
            <Button
              className="mt-2 mb-2 ml-auto"
              style={{ width: "200px" }}
              onClick={async () => {
                track("Health Tab Onboarding Opened", { source: "health-tab" });
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
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  if (snapshot?.health?.traffic.error === "TOO_MANY_ROWS") {
    return (
      <div className="alert alert-danger mt-3">
        Please update your{" "}
        <Link href={`/datasources/${experiment.datasource}`}>
          Datasource Settings
        </Link>{" "}
        to return fewer dimension slices per dimension or select fewer
        dimensions to use in traffic breakdowns. For more advice, see the
        documentation on the Health Tab{" "}
        <a href="https://docs.growthbook.io/app/experiment-results#adding-dimensions-to-health-tab">
          here
        </a>
        .
      </div>
    );
  }

  if (snapshot?.health?.traffic.error === "NO_ROWS_IN_UNIT_QUERY") {
    return (
      <div className="alert alert-info mt-3">
        No data found. It is likely there are no units in your experiment yet.
      </div>
    );
  }

  if (snapshot?.health?.traffic.error) {
    return (
      <div className="alert alert-info mt-3">
        There was an error running the query for health tab:{" "}
        {snapshot?.health?.traffic.error}.
      </div>
    );
  }

  if (!snapshot?.health?.traffic.dimension?.dim_exposure_date) {
    if (loading) {
      return (
        <div className="alert alert-info mt-3">
          <LoadingSpinner /> Snapshot refreshing, health data loading...
        </div>
      );
    }
    if (!datasource || !exposureQuery) {
      return (
        <div className="alert alert-info mt-3">
          {noExposureQueryMessage}
          {
            " Then, next time you update results, the health tab will be available."
          }
        </div>
      );
    }
    return (
      <div className="alert alert-info mt-3">
        Please return to the results page and run a query to see health data.
      </div>
    );
  }

  const totalUsers = snapshot?.health?.traffic?.overall?.variationUnits?.reduce(
    (acc, a) => acc + a,
    0
  );

  const traffic = snapshot.health.traffic;

  const phaseObj = experiment.phases?.[phase];

  const variations = experiment.variations.map((v, i) => {
    return {
      id: v.key || i + "",
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  return (
    <div className="mt-4">
      <IssueTags issues={healthIssues} />
      <TrafficCard traffic={traffic} variations={variations} />
      <div id={"balanceCheck"} style={{ scrollMarginTop: "100px" }}>
        <SRMDrawer
          traffic={traffic}
          variations={variations}
          totalUsers={totalUsers}
          onNotify={handleDrawerNotify}
          dataSource={datasource}
          exposureQuery={exposureQuery}
          healthTabConfigParams={healthTabConfigParams}
        />
      </div>

      <div className="row">
        <div
          className="col-8"
          id="multipleExposures"
          style={{ scrollMarginTop: "100px" }}
        >
          <MultipleExposuresDrawer
            totalUsers={totalUsers}
            onNotify={handleDrawerNotify}
          />
        </div>
      </div>
    </div>
  );
}
