import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useState } from "react";
import { getScopedSettings } from "shared/settings";
import { upperFirst } from "lodash";
import { expandMetricGroups } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import AnalysisForm from "@/components/Experiment/AnalysisForm";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function AnalysisSettings({ experiment, mutate }: Props) {
  const {
    getDatasourceById,
    getProjectById,
    getExperimentMetricById,
    metricGroups,
  } = useDefinitions();
  const { organization } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const [analysisModal, setAnalysisModal] = useState(false);

  const project = getProjectById(experiment.project || "");

  const canEditAnalysisSettings = permissionsUtil.canUpdateExperiment(
    experiment,
    {}
  );

  const { settings: scopedSettings } = getScopedSettings({
    organization,
    project: project ?? undefined,
    experiment: experiment,
  });

  const datasource = experiment
    ? getDatasourceById(experiment.datasource)
    : null;

  const assignmentQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
  );

  const statsEngine = scopedSettings.statsEngine.value;

  const goals: string[] = [];
  expandMetricGroups(experiment.goalMetrics ?? [], metricGroups).forEach(
    (m) => {
      const name = getExperimentMetricById(m)?.name;
      if (name) goals.push(name);
    }
  );
  const secondary: string[] = [];
  expandMetricGroups(experiment.secondaryMetrics ?? [], metricGroups).forEach(
    (m) => {
      const name = getExperimentMetricById(m)?.name;
      if (name) secondary.push(name);
    }
  );
  const guardrails: string[] = [];
  expandMetricGroups(experiment.guardrailMetrics ?? [], metricGroups).forEach(
    (m) => {
      const name = getExperimentMetricById(m)?.name;
      if (name) guardrails.push(name);
    }
  );

  const isBandit = experiment.type === "multi-armed-bandit";

  return (
    <>
      {analysisModal && (
        <AnalysisForm
          cancel={() => setAnalysisModal(false)}
          experiment={experiment}
          mutate={mutate}
          phase={experiment.phases.length - 1}
          editDates={true}
          editVariationIds={false}
          editMetrics={true}
          source={"analysis-settings"}
        />
      )}

      <div className="box p-4 my-4">
        <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
          <h4 className="m-0">分析设置</h4>
          <div className="flex-1" />
          {canEditAnalysisSettings ? (
            <button
              className="btn p-0 link-purple"
              onClick={() => {
                setAnalysisModal(true);
              }}
            >
              <span className="text-purple">编辑</span>
            </button>
          ) : null}
        </div>

        <div className="row">
          <div className="col-4">
            <div className="h5">数据源</div>
            <div>{datasource ? datasource.name : <em>无</em>}</div>
          </div>

          <div className="col-4">
            <div className="h5">实验分配表</div>
            <div>{assignmentQuery ? assignmentQuery.name : <em>无</em>}</div>
          </div>

          {!isBandit && (
            <div className="col-4">
              <div className="h5">统计引擎</div>
              <div>{upperFirst(statsEngine)}</div>
            </div>
          )}
          {isBandit && (
            <div className="col-4">
              <div className="h5">CUPED</div>
              <div>
                {experiment.regressionAdjustmentEnabled
                  ? "已启用"
                  : "已禁用"}
              </div>
            </div>
          )}
        </div>

        <div className="row mt-4">
          <div className="col-4">
            <div className="h5">
              {!isBandit ? "目标指标" : "决策指标"}
            </div>
            <div>
              {goals.length ? (
                <ul className="list-unstyled mb-0">
                  {goals.map((metric, i) => {
                    if (isBandit && i > 0) return null;
                    return <li key={`goal-${i}`}>{metric}</li>;
                  })}
                </ul>
              ) : (
                <em>无</em>
              )}
            </div>
          </div>

          <div className="col-4">
            <div className="h5">次要指标</div>
            <div>
              {secondary.length ? (
                <ul className="list-unstyled mb-0">
                  {secondary.map((metric, i) => (
                    <li key={`secondary-${i}`}>{metric}</li>
                  ))}
                </ul>
              ) : (
                <em>无</em>
              )}
            </div>
          </div>

          <div className="col-4">
            <div className="h5">护栏指标</div>
            <div>
              {guardrails.length ? (
                <ul className="list-unstyled mb-0">
                  {guardrails.map((metric, i) => (
                    <li key={`guardrail-${i}`}>{metric}</li>
                  ))}
                </ul>
              ) : (
                <em>无</em>
              )}
            </div>
          </div>
        </div>

        {isBandit && (
          <div className="row mt-4">
            <div className="col-4">
              <div className="h5">探索阶段</div>
              <div>
                {experiment.banditBurnInValue ?? 1}{" "}
                {(experiment.banditBurnInUnit ?? "days") === "days"
                  ? "day"
                  : "hour"}
                {(experiment.banditBurnInValue ?? 1) !== 1 ? "s" : ""}
              </div>
            </div>

            <div className="col-4">
              <div className="h5">更新频率</div>
              <div>
                Every {experiment.banditScheduleValue ?? 1}{" "}
                {(experiment.banditScheduleUnit ?? "days") === "days"
                  ? "days"
                  : "hours"}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
