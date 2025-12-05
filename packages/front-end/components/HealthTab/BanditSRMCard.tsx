import { BanditEvent } from "shared/src/validators/experiments";
import React, { useEffect, useMemo, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getSRMHealthData, getSRMValue } from "shared/health";
import {
  DEFAULT_SRM_THRESHOLD,
  DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
} from "shared/constants";
import { useUser } from "@/services/UserContext";
import BanditSRMGraph from "@/components/HealthTab/BanditSRMGraph";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import { pValueFormatter } from "@/services/experiments";
import SRMWarning from "@/components/Experiment/SRMWarning";
import { StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  phase: ExperimentPhaseStringDates;
  onNotify: (issue: IssueValue) => void;
}

export default function BanditSRMCard({
  experiment,
  snapshot,
  phase,
  onNotify,
}: Props) {
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const banditEvents: BanditEvent[] = phase?.banditEvents ?? [];
  const currentEvent = banditEvents?.[banditEvents.length - 1];

  const srm = getSRMValue("multi-armed-bandit", snapshot);
  const users = experiment.variations.map(
    (_, i) =>
      currentEvent?.banditResult?.singleVariationResults?.[i]?.users ?? 0,
  );
  const totalUsers = users.reduce((sum, u) => sum + (u ?? 0), 0) ?? 0;

  const [chartMode, setChartMode] = useState<"weights" | "users">("users");

  const overallHealth = useMemo(
    () =>
      getSRMHealthData({
        srm: srm ?? Infinity,
        srmThreshold,
        numOfVariations: experiment.variations.length,
        totalUsersCount: totalUsers,
        minUsersPerVariation: DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
      }),
    [srm, srmThreshold, experiment.variations.length, totalUsers],
  );

  useEffect(() => {
    if (overallHealth === "unhealthy") {
      onNotify({ label: "Experiment Balance", value: "balanceCheck" });
    }
  }, [overallHealth, onNotify]);

  if (srm === undefined) {
    return (
      <div className="box my-4 p-3">
        <div className="alert alert-danger">Traffic data is missing</div>
      </div>
    );
  }

  return (
    <div className="box container-fluid my-4 p-3">
      <div className="row overflow-hidden" id="parent-container">
        <div className="col-12">
          <h2 className="d-inline">Experiment Balance Check</h2>{" "}
          {overallHealth !== "healthy" && (
            <StatusBadge status={overallHealth} />
          )}
          <p className="mt-1">
            Shows actual unit split compared to percent selected for the
            experiment
          </p>
          <hr />
          <div>
            <div className="mb-3">
              <label className="uppercase-title">Chart</label>
              <ButtonSelectField
                value={chartMode}
                setValue={(v) => setChartMode(v)}
                options={[
                  {
                    label: "Actual & Expected Traffic",
                    value: "users",
                  },
                  {
                    label: "Actual & Expected Traffic Split",
                    value: "weights",
                  },
                ]}
              />
            </div>
            <BanditSRMGraph
              experiment={experiment}
              phase={phase}
              mode={chartMode}
            />
          </div>
          <div>
            {overallHealth !== "not-enough-traffic" ? (
              <>
                <div className="text-muted mx-3 mb-2">
                  p-value:{" "}
                  {srm !== undefined ? pValueFormatter(srm, 4) : <em>n/a</em>}
                </div>
                <SRMWarning
                  srm={srm ?? Infinity}
                  users={users}
                  showWhenHealthy
                  isBandit={true}
                />
              </>
            ) : (
              <div className="alert alert-info font-weight-bold">
                More traffic is required to detect a Sample Ratio Mismatch
                (SRM).
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
