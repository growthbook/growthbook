import { BanditEvent } from "shared/validators";
import React, { useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { getBanditSRMValue } from "shared/health";
import { DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION } from "shared/constants";
import { getLatestPhaseVariations } from "shared/experiments";
import BanditSRMGraph from "@/components/HealthTab/BanditSRMGraph";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import { pValueFormatter } from "@/services/experiments";
import SRMWarning from "@/components/Experiment/SRMWarning";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import SRMCardShell, { useSrmHealth } from "./SRMCardShell";
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
  const banditEvents: BanditEvent[] = phase?.banditEvents ?? [];
  const currentEvent = banditEvents?.[banditEvents.length - 1];

  const srm = getBanditSRMValue(snapshot);
  const users = getLatestPhaseVariations(experiment).map(
    (_, i) =>
      currentEvent?.banditResult?.singleVariationResults?.[i]?.users ?? 0,
  );
  const totalUsers = users.reduce((sum, u) => sum + (u ?? 0), 0) ?? 0;

  const [chartMode, setChartMode] = useState<"weights" | "users">("users");

  const numOfVariations = getLatestPhaseVariations(experiment).length;
  const overallHealth = useSrmHealth({
    srm: srm ?? Infinity,
    numOfVariations,
    totalUsersCount: totalUsers,
    minUsersPerVariation: DEFAULT_SRM_BANDIT_MINIMINUM_COUNT_PER_VARIATION,
    onNotify,
  });

  if (srm === undefined) {
    return (
      <div className="box my-4 p-3">
        <Callout status="error">Traffic data is missing</Callout>
      </div>
    );
  }

  return (
    <SRMCardShell
      title="Experiment Balance Check"
      description="Shows actual unit split compared to percent selected for the experiment"
      srmHealth={overallHealth}
      className="box container-fluid my-4 p-3"
    >
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
          <Callout status="info">
            <Text weight="semibold">
              More traffic is required to detect a Sample Ratio Mismatch (SRM).
            </Text>
          </Callout>
        )}
      </div>
    </SRMCardShell>
  );
}
