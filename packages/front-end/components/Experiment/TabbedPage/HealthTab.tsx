import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useMemo, useState } from "react";
import { getValidDate } from "shared/dates";
import Toggle from "@/components/Forms/Toggle";
import HealthDrawer from "@/components/HealthTab/HealthDrawer";
import { useSnapshot } from "../SnapshotProvider";
import MultipleExposureWarning from "../MultipleExposureWarning";
import ExperimentDateGraph, {
  ExperimentDateGraphDataPoint,
} from "../ExperimentDateGraph";
import VariationUsersTable from "./VariationUsersTable";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
}

const numberFormatter = new Intl.NumberFormat();

const UnitCountDateGraph = ({ results, seriestype, variations }) => {
  const [cumulative, setCumulative] = useState(false);

  // Get data for users graph
  const users = useMemo<ExperimentDateGraphDataPoint[]>(() => {
    // Keep track of total users per variation for when cumulative is true
    const total: number[] = [];
    const sortedResults = [...results];
    sortedResults.sort((a, b) => {
      return getValidDate(a.name).getTime() - getValidDate(b.name).getTime();
    });

    return sortedResults.map((d) => {
      return {
        d: getValidDate(d.name),
        variations: variations.map((variation, i) => {
          const users = d.variations[i]?.users || 0;
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
      };
    });
  }, [results, variations, cumulative]);

  return (
    <>
      {seriestype === "pre:date" && (
        <div className="mb-3 d-flex align-items-center">
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
      )}
      <div className="mb-2">
        <h2>Experiment Traffic</h2>
        <ExperimentDateGraph
          yaxis="users"
          variationNames={variations.map((v) => v.name)}
          label="Users"
          datapoints={users}
          tickFormat={(v) => numberFormatter.format(v)}
        />
      </div>
    </>
  );
};

export default function HealthTab({ experiment }: Props) {
  const {
    error,
    snapshot,
    analysis,
    latest,
    phase,
    dimension,
    mutateSnapshot: mutate,
    loading: snapshotLoading,
  } = useSnapshot();

  const [balanceCheckOpen, setBalanceCheckOpen] = useState(false);

  //TODO: grab "" dimension and "pre:date" dimension

  const [totalUsers, variationUsers] = useMemo(() => {
    let totalUsers = 0;
    const variationUsers: number[] = [];
    analysis?.results[0]?.variations?.forEach((v, i) => {
      totalUsers += v.users;
      variationUsers[i] = variationUsers[i] || 0;
      variationUsers[i] += v.users;
    });
    return [totalUsers, variationUsers];
  }, [analysis?.results]);

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
      <MultipleExposureWarning
        users={variationUsers}
        multipleExposures={123456}
      />
      {/* <UnitCountDateGraph
        results={analysis?.results ?? []}
        seriestype={snapshot?.dimension ?? ""}
        variations={variations}
      /> */}
      <HealthDrawer
        title="Experiment Balance Check"
        status="healthy"
        open={balanceCheckOpen}
        handleOpen={setBalanceCheckOpen}
      >
        <VariationUsersTable
          users={variationUsers}
          variations={variations}
          srm={analysis?.results[0].srm} // Why do we use the 0-index?
          hasHealthData
        />{" "}
      </HealthDrawer>
    </>
  );
}
