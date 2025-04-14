import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import Callout from "@/components/Radix/Callout";
import {
  HealthTabConfigParams,
  HealthTabOnboardingModal,
} from "./HealthTabOnboardingModal";

const noExposureQueryMessage = "只有当你的实验有一个曝光分配表时，健康标签页才会起作用。在结果标签页上，点击“分析设置”，并确保你选择了正确的曝光分配表。";

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
  const { runHealthTrafficQuery } = useOrgSettings();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId
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

  const handleHealthNotification = useCallback(
    (issue: IssueValue) => {
      setHealthIssues((prev) => {
        const issueSet: Set<IssueValue> = new Set([...prev, issue]);
        return [...issueSet];
      });
      onHealthNotify();
    },
    [onHealthNotify]
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
      <Callout status="info" mt="3">
        <div className="d-flex">
          {runHealthTrafficQuery === undefined
            ? "欢迎来到新的健康标签页！你可以使用此标签页查看实验流量随时间的变化、执行平衡检查以及检查多次曝光情况。要开始使用，"
            : "在你的组织设置中，健康查询已被禁用。要启用它们并设置健康标签页，"}
          {hasPermissionToConfigHealthTag ? (
            <>
              点击右侧按钮.
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
                设置健康标签页
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
            "请你组织中的管理员导航到任何实验的健康标签页，并按照引导流程进行操作。"
          )}
        </div>
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
          请更新你的{" "}
          <Link href={`/datasources/${experiment.datasource}`}>
            数据源设置
          </Link>{" "}
          ，以减少每个维度返回的维度切片数量，或者选择较少的维度用于流量细分。
        </div>

        <div>
          如需更多建议，请参阅健康标签页的文档，网址为{" "}
          <a href="https://docs.growthbook.io/app/experiment-results#adding-dimensions-to-health-tab">
            此处
          </a>
          。
        </div>
      </Callout>
    );
  }

  if (snapshot?.health?.traffic.error === "NO_ROWS_IN_UNIT_QUERY") {
    return (
      <Callout status="info" mt="3">
        未找到数据。很可能你的实验中目前还没有单元数据。
      </Callout>
    );
  }

  // 如果快照的健康流量数据存在其他错误
  if (snapshot?.health?.traffic.error) {
    return (
      <Callout status="info" mt="3">
        运行健康标签页的查询时出现错误：{" "}
        {snapshot?.health?.traffic.error}。
      </Callout>
    );
  }

  // 如果快照的健康流量数据中没有曝光日期维度数据
  if (!snapshot?.health?.traffic.dimension?.dim_exposure_date) {
    if (loading) {
      return (
        <Callout status="info" mt="3">
          <LoadingSpinner /> 快照正在刷新，健康数据正在加载...
        </Callout>
      );
    }
    if (!datasource || !exposureQuery) {
      return (
        <Callout status="info" mt="3">
          {noExposureQueryMessage} 然后，下次你更新结果时，健康标签页将可用。
        </Callout>
      );
    }
    if (isBandit) {
      if (experiment.status === "draft") {
        return (
          <Callout status="info" mt="3">
            启动多臂老虎机实验以查看健康数据。
          </Callout>
        );
      } else {
        return (
          <Callout status="info" mt="3">
            尚未有更新。成功刷新结果后，将显示流量和健康结果。
          </Callout>
        );
      }
    }
    return (
      <Callout status="info" mt="3">
        请返回结果页面并运行查询以查看健康数据。
      </Callout>
    );
  }

  // 计算总用户数
  const totalUsers = snapshot?.health?.traffic?.overall?.variationUnits?.reduce(
    (acc, a) => acc + a,
    0
  );

  // 获取流量数据
  const traffic = snapshot.health.traffic;

  // 获取当前阶段的对象
  const phaseObj = experiment.phases?.[phase];

  // 处理实验变体数据
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
            experiment={experiment}
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
          />
        </div>
      </div>
    </div>
  );
}