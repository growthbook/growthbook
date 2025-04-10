import { BanditEvent } from "back-end/src/validators/experiments";
import React, { useEffect, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useUser } from "@/services/UserContext";
import { DEFAULT_SRM_THRESHOLD } from "@/pages/settings";
import BanditSRMGraph from "@/components/HealthTab/BanditSRMGraph";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import { pValueFormatter } from "@/services/experiments";
import SRMWarning from "@/components/Experiment/SRMWarning";
import { HealthStatus, StatusBadge } from "./StatusBadge";
import { IssueValue } from "./IssueTags";

export const srmHealthCheck = ({
  srm,
  numVariations,
  srmThreshold,
  totalUsers,
}: {
  srm: number;
  numVariations: number;
  srmThreshold: number;
  totalUsers: number;
}): HealthStatus => {
  if (totalUsers && totalUsers < 5 * numVariations) {
    return "Not enough traffic";
  } else if (srm >= srmThreshold) {
    return "healthy";
  }
  return "Issues detected";
};

interface Props {
  experiment: ExperimentInterfaceStringDates;
  phase: ExperimentPhaseStringDates;
  onNotify: (issue: IssueValue) => void;
}

export default function BanditSRMCard({ experiment, phase, onNotify }: Props) {
  const { settings } = useUser();

  const srmThreshold = settings.srmThreshold ?? DEFAULT_SRM_THRESHOLD;

  const banditEvents: BanditEvent[] = phase?.banditEvents ?? [];
  const currentEvent = banditEvents?.[banditEvents.length - 1];
  const srm = currentEvent?.banditResult?.srm;
  const users = experiment.variations.map(
    (_, i) =>
      currentEvent?.banditResult?.singleVariationResults?.[i]?.users ?? 0
  );
  const totalUsers = users.reduce((sum, u) => sum + (u ?? 0), 0) ?? 0;

  const [chartMode, setChartMode] = useState<"weights" | "users">("users");

  const overallHealth: HealthStatus = srmHealthCheck({
    srm: srm ?? Infinity,
    srmThreshold,
    numVariations: experiment.variations.length,
    totalUsers,
  });

  useEffect(() => {
    if (overallHealth === "Issues detected") {
      onNotify({ label: "实验平衡", value: "balanceCheck" });
    }
  }, [overallHealth, onNotify]);

  if (srm === undefined) {
    return (
      <div className="box my-4 p-3">
        <div className="alert alert-danger">流量数据缺失</div>
      </div>
    );
  }

  return (
    <div className="box container-fluid my-4 p-3">
      <div className="row overflow-hidden" id="parent-container">
        <div className="col-12">
          <h2 className="d-inline">实验平衡检查</h2>{" "}
          {overallHealth && overallHealth !== "healthy" && (
            <StatusBadge status={overallHealth} />
          )}
          <p className="mt-1">
            显示实际单位分配与实验所选百分比的对比
          </p>
          <hr />
          <div>
            <div className="mb-3">
              <label className="uppercase-title">图表</label>
              <ButtonSelectField
                value={chartMode}
                setValue={(v) => setChartMode(v)}
                options={[
                  {
                    label: "实际和预期流量",
                    value: "users",
                  },
                  {
                    label: "实际和预期流量分配",
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
            {(overallHealth === "healthy" ||
              overallHealth === "Issues detected") && (
                <>
                  <div className="text-muted mx-3 mb-2">
                    p-value:{" "}
                    {srm !== undefined ? pValueFormatter(srm, 4) : <em>n/a</em>}
                  </div>
                  <SRMWarning
                    srm={srm !== undefined ? srm : Infinity}
                    users={users}
                    showWhenHealthy
                    isBandit={true}
                  />
                </>
              )}
            {overallHealth === "Not enough traffic" && (
              <div className="alert alert-info font-weight-bold">
                需要更多流量才能检测到样本比例不匹配 (SRM).
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
