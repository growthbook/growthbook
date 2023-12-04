import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SRMDrawer from "@/components/HealthTab/SRMDrawer";
import MultipleExposuresDrawer from "@/components/HealthTab/MultipleExposuresDrawer";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Button from "@/components/Button";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import { IssueTags, IssueValue } from "@/components/HealthTab/IssueTags";
import { useSnapshot } from "../SnapshotProvider";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  onDrawerNotify: () => void;
  onSnapshotUpdate: () => void;
}

export default function HealthTab({
  experiment,
  onDrawerNotify,
  onSnapshotUpdate,
}: Props) {
  const { error, snapshot, phase } = useSnapshot();
  const { runHealthTrafficQuery } = useOrgSettings();
  const { apiCall } = useAuth();
  const { refreshOrganization } = useUser();
  const permissions = usePermissions();
  const hasPermissionToEditOrgSettings = permissions.check(
    "organizationSettings"
  );
  const [healthIssues, setHealthIssues] = useState<IssueValue[]>([]);
  // Clean up notification counter before unmounting
  useEffect(() => {
    return () => {
      onSnapshotUpdate();
      setHealthIssues([]);
    };
  }, [snapshot, onSnapshotUpdate]);

  const enableRunHealthTrafficQueries = async () => {
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: { runHealthTrafficQuery: true },
      }),
    });
    refreshOrganization();
  };

  const handleDrawerNotify = useCallback(
    (issue: IssueValue) => {
      setHealthIssues((prev) => [...prev, issue]);
      onDrawerNotify();
    },
    [onDrawerNotify]
  );

  // If org has not updated settings since the health tab was introduced, prompt the user
  // to enable the traffic query setting
  if (!runHealthTrafficQuery) {
    return (
      <div className="alert alert-info mt-3 d-flex">
        {runHealthTrafficQuery === undefined
          ? "Welcome to the new health tab! You can use this tab to view experiment traffic over time, perform balance checks, and check for multiple exposures. To get started, "
          : "Health queries are disabled in your Organization Settings. To enable them, "}
        {hasPermissionToEditOrgSettings ? (
          <>
            click the enable button on the right.
            <Button
              className="mt-2 mb-2 ml-auto"
              style={{ width: "200px" }}
              onClick={async () => await enableRunHealthTrafficQueries()}
            >
              Enable Health Queries
            </Button>
          </>
        ) : (
          "ask someone with permission to manage organization settings to enable Run traffic query by default under the Experiment Health Settings section."
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
      {/* <a href="#multipleExposures">TESTING SCROLL</a> */}
      {/* <h4 className="mt-2 mb-4">No issues found. 🎉</h4> */}
      <IssueTags issues={healthIssues} />
      <TrafficCard traffic={traffic} variations={variations} />
      <div id="balanceCheck">
        <SRMDrawer
          traffic={traffic}
          variations={variations}
          totalUsers={totalUsers}
          datasource={experiment.datasource}
          onNotify={handleDrawerNotify}
        />
      </div>
      <div className="row">
        <div className="col-8" id="multipleExposures">
          <MultipleExposuresDrawer
            multipleExposures={snapshot.multipleExposures}
            totalUsers={totalUsers}
            onNotify={handleDrawerNotify}
          />
        </div>
      </div>
    </div>
  );
}
