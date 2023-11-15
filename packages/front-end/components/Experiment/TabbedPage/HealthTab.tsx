import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useMemo, useState } from "react";
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
import { useSnapshot } from "../SnapshotProvider";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "../ExperimentDateGraph";
import { SRM_THRESHOLD } from "../SRMWarning";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
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

  const srmThreshold = settings.srmThreshold ?? SRM_THRESHOLD;

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

export default function HealthTab({ experiment }: Props) {
  const { error, snapshot, phase } = useSnapshot();
  const { runHealthTrafficQuery } = useOrgSettings();
  const permissions = usePermissions();
  const hasPermissionToEditOrgSettings = permissions.check(
    "organizationSettings"
  );

  // If org has not updated settings since the health tab was introduced, prompt the user
  // to enable the traffic query setting
  if (runHealthTrafficQuery === undefined) {
    return (
      <div className="alert alert-info mt-3">
        Welcome to the new health tab! You can use this tab to view experiment
        traffic over time, perform balance checks, and check for multiple
        exposures. To get started,{" "}
        {hasPermissionToEditOrgSettings ? (
          <>
            visit your <Link href={"/settings"}>Organization Settings</Link> and
            enable <b>Run traffic query by default</b> under the Experiment
            Health Settings section.
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

  // TODO: Grab the datasource id and link the user to the specific datasource page
  if (snapshot?.health?.traffic.error === "TOO_MANY_ROWS") {
    return (
      <div className="alert alert-danger mt-3">
        Your selected dimensions for the health breakdown have too many slices
        to be computed. Please go to your{" "}
        <Link href={"/datasources/"}>
          <a>Datasource Settings</a>
        </Link>{" "}
        and select fewer dimensions
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

  const totalUsers = snapshot?.health?.traffic.overall[0].variationUnits.reduce(
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
    <>
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
      />
      <MultipleExposuresDrawer
        multipleExposures={snapshot.multipleExposures}
        totalUsers={totalUsers}
      />
    </>
  );
}
