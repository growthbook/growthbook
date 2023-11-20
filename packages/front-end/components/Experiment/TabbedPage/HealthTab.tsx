import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useEffect, useMemo, useState } from "react";
import { getValidDate } from "shared/dates";
import { ExperimentSnapshotTrafficDimension } from "back-end/types/experiment-snapshot";
import Link from "next/link";
import { ExperimentReportVariation } from "back-end/types/report";
import Toggle from "@/components/Forms/Toggle";
import HealthDrawer from "@/components/HealthTab/HealthDrawer";
import SRMDrawer from "@/components/HealthTab/SRMDrawer";
import MultipleExposuresDrawer from "@/components/HealthTab/MultipleExposuresDrawer";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import useOrgSettings from "@/hooks/useOrgSettings";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import { useAuth } from "@/services/auth";
import Button from "@/components/Button";
import { useSnapshot } from "../SnapshotProvider";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "../ExperimentDateGraph";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  onDrawerNotify: () => void;
  onSnapshotUpdate: () => void;
}

const numberFormatter = new Intl.NumberFormat();

const UnitCountDateGraph = ({
  trafficByDate,
  variations,
}: {
  trafficByDate: ExperimentSnapshotTrafficDimension[];
  variations: ExperimentReportVariation[];
}) => {
  const [cumulative, setCumulative] = useState(false);
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  // Get data for users graph
  const usersPerDate = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    // Keep track of total users per variation for when cumulative is true
    const total: number[] = [];
    const sortedTraffic = [...trafficByDate];
    sortedTraffic.sort((a, b) => {
      return getValidDate(a.name).getTime() - getValidDate(b.name).getTime();
    });

    return sortedTraffic.map((d) => {
      return {
        d: getValidDate(d.name),
        variations: variations.map((variation, i) => {
          const users = d.variationUnits[i] || 0;
          total[i] = total[i] || 0;
          total[i] += users;
          const v = cumulative ? total[i] : users;
          const v_formatted = v + "";
          return {
            v,
            v_formatted,
            label: numberFormatter.format(v),
          };
        }),
        srm: d.srm,
      };
    });
  }, [trafficByDate, variations, cumulative]);

  return (
    <>
      <div className="mt-3 mb-3 d-flex align-items-center">
        <div className="mr-3">
          <strong>Graph Controls: </strong>
        </div>
        <div>
          <Toggle
            label="Cumulative"
            id="cumulative"
            value={cumulative}
            setValue={setCumulative}
          />
          Cumulative
        </div>
      </div>

      <div className="mt-2 mb-2">
        <ExperimentDateGraph
          yaxis="users"
          variationNames={variations.map((v) => v.name)}
          label="Users"
          datapoints={usersPerDate}
          tickFormat={(v) => numberFormatter.format(v)}
          srmThreshold={cumulative ? undefined : srmThreshold}
        />
      </div>
    </>
  );
};

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

  // Clean up notification counter before unmounting
  useEffect(() => {
    return () => {
      onSnapshotUpdate();
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
              className="mt-2 mb-2"
              style={{ width: "200px" }}
              onClick={async () => await enableRunHealthTrafficQueries()}
            >
              Enable Health Queries
            </Button>
          </>
        ) : (
          <>
            ask someone with permission to manage organization settings to
            enable <b>Run traffic query by default</b> under the Experiment
            Health Settings section.
          </>
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
  const dimensions = snapshot.health.traffic.dimension;

  const trafficByDate = dimensions?.dim_exposure_date;

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
      <HealthDrawer title="Experiment Traffic" openByDefault>
        <UnitCountDateGraph
          trafficByDate={trafficByDate}
          variations={variations}
        />
      </HealthDrawer>
      <SRMDrawer
        traffic={traffic}
        variations={variations}
        totalUsers={totalUsers}
        datasource={experiment.datasource}
        onNotify={onDrawerNotify}
      />
      <MultipleExposuresDrawer
        multipleExposures={snapshot.multipleExposures}
        totalUsers={totalUsers}
        onNotify={onDrawerNotify}
      />
    </div>
  );
}
