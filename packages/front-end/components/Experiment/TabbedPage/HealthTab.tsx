import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotTraffic,
} from "shared/types/experiment-snapshot";
import {
  DataSourceInterfaceWithParams,
  ExposureQuery,
} from "shared/types/datasource";
import { getLatestPhaseVariations } from "shared/experiments";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DECISION_FRAMEWORK_ENABLED } from "shared/constants";
import { Flex } from "@radix-ui/themes";
import Link from "@/ui/Link";
import SRMCard from "@/components/HealthTab/SRMCard";
import CovariateImbalanceCard from "@/components/HealthTab/CovariateImbalanceCard";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import ClusterIssueCard from "@/components/HealthTab/ClusterIssueCard";
import ClusterReliabilityCard from "@/components/HealthTab/ClusterReliabilityCard";
import { IdentifierCode } from "@/components/Experiment/AssignmentQueryFields";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Button from "@/ui/Button";
import TrafficCard from "@/components/HealthTab/TrafficCard";
import ExposureLogsCard from "@/components/HealthTab/ExposureLogsCard";
import { IssueTags, IssueValue } from "@/components/HealthTab/IssueTags";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useDefinitions } from "@/services/DefinitionsContext";
import track from "@/services/track";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import BanditSRMCard from "@/components/HealthTab/BanditSRMCard";
import Callout from "@/ui/Callout";
import { PowerCard } from "@/components/HealthTab/PowerCard";
import {
  HealthTabConfigParams,
  HealthTabOnboardingModal,
} from "./HealthTabOnboardingModal";

const noExposureQueryMessage =
  "The health tab only works when your experiment has an Exposure Assignment Table. On the Results tab, click Analysis Settings and ensure you have selected the correct Exposure Assignment Table.";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  onHealthNotify: () => void;
  onSnapshotUpdate: () => void;
  resetResultsSettings: () => void;
  isTabActive: boolean;
}

export default function HealthTab({
  experiment,
  onHealthNotify,
  onSnapshotUpdate,
  resetResultsSettings,
  isTabActive,
}: Props) {
  const {
    error,
    dimensionless: snapshot,
    phase,
    mutate,
    setAnalysisSettings,
  } = useSnapshot();

  const {
    runHealthTrafficQuery,
    decisionFrameworkEnabled,
    useStickyBucketing,
  } = useOrgSettings();
  const { refreshOrganization } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );

  const hasPermissionToConfigHealthTag =
    (datasource &&
      permissionsUtil.canManageOrgSettings() &&
      permissionsUtil.canRunHealthQueries(datasource) &&
      permissionsUtil.canUpdateDataSourceSettings(datasource)) ||
    false;
  const [healthIssues, setHealthIssues] = useState<IssueValue[]>([]);
  // Cards bubble issues via effects that re-fire on every snapshot reference
  // change, even when the underlying issue is one we've already counted. The
  // parent badge counter (`onHealthNotify`) is just an incrementer, so without
  // a synchronous dedupe it would drift up on every poll/refetch. A Set ref
  // is the dedupe source of truth.
  // Ideally we have a separate service that does the health computation and it
  // doesn't happen inside each card. TODO later.
  const seenIssueValuesRef = useRef<Set<string>>(new Set());
  const [setupModalOpen, setSetupModalOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";
  const orgStickyBucketing = !!useStickyBucketing;

  const showMultipleExposures =
    !isBandit ||
    (isBandit && orgStickyBucketing && !experiment.disableStickyBucketing);

  const healthTabConfigParams: HealthTabConfigParams = {
    experiment,
    phase,
    refreshOrganization,
    mutate,
    setAnalysisSettings,
    setLoading,
    resetResultsSettings,
  };

  // Reset the parent counter, the local issues list, and the dedupe set
  // together whenever the snapshot identity changes (or we unmount). Keeping
  // these three in lockstep is what guarantees the badge counts only issues
  // present in the current snapshot.
  useEffect(() => {
    return () => {
      seenIssueValuesRef.current = new Set();
      onSnapshotUpdate();
      setHealthIssues([]);
    };
  }, [experiment.id, snapshot?.id, onSnapshotUpdate]);

  const handleHealthNotification = useCallback(
    (issue: IssueValue) => {
      if (seenIssueValuesRef.current.has(issue.value)) return;
      seenIssueValuesRef.current.add(issue.value);
      setHealthIssues((prev) => [...prev, issue]);
      onHealthNotify();
    },
    [onHealthNotify],
  );

  // Returns the banner to render instead of the snapshot-derived cards, or
  // null when the snapshot is healthy. The exposure logs card below renders
  // either way: it queries the warehouse directly and needs no snapshot.
  function getSnapshotBlocker(): ReactNode | null {
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
          <Flex gap="4">
            {runHealthTrafficQuery === undefined
              ? "Welcome to the new health tab! You can use this tab to view experiment traffic over time, perform balance checks, and check for multiple exposures. To get started, "
              : "Health queries are disabled in your Organization Settings. To enable them and set up the health tab, "}
            {hasPermissionToConfigHealthTag ? (
              <>
                click the button on the right.
                <Button
                  color="inherit"
                  ml="2"
                  style={{ width: "200px" }}
                  onClick={async () => {
                    track("Health Tab Onboarding Opened", {
                      source: "health-tab",
                    });
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
          </Flex>
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
            Please update your{" "}
            <Link href={`/datasources/${experiment.datasource}`}>
              Datasource Settings
            </Link>{" "}
            to return fewer dimension slices per dimension or select fewer
            dimensions to use in traffic breakdowns.
          </div>

          <div>
            For more advice, see the documentation on the Health Tab{" "}
            <a href="https://docs.growthbook.io/app/experiment-results#adding-dimensions-to-health-tab">
              here
            </a>
            .
          </div>
        </Callout>
      );
    }

    if (snapshot?.health?.traffic.error === "NO_ROWS_IN_UNIT_QUERY") {
      return (
        <Callout status="info" mt="3">
          No data found. It is likely there are no units in your experiment yet.
        </Callout>
      );
    }

    if (snapshot?.health?.traffic.error) {
      return (
        <Callout status="info" mt="3">
          There was an error running the query for health tab:{" "}
          {snapshot?.health?.traffic.error}.
        </Callout>
      );
    }

    if (!snapshot?.health?.traffic.dimension?.dim_exposure_date) {
      if (loading) {
        return (
          <Callout status="info" mt="3" icon={<LoadingSpinner />}>
            Snapshot refreshing, health data loading...
          </Callout>
        );
      }
      if (!datasource || !exposureQuery) {
        return (
          <Callout status="info" mt="3">
            {noExposureQueryMessage} Then, next time you update results, the
            health tab will be available.
          </Callout>
        );
      }
      if (isBandit) {
        if (experiment.status === "draft") {
          return (
            <Callout status="info" mt="3">
              Start the Bandit to see health data.
            </Callout>
          );
        } else {
          return (
            <Callout status="info" mt="3">
              No updates yet. Traffic and health results will appear after a
              successful refresh of the results.
            </Callout>
          );
        }
      }
      return (
        <Callout status="info" mt="3">
          Please return to the results page and run a query to see health data.
        </Callout>
      );
    }
    return null;
  }

  const blocker = getSnapshotBlocker();
  const traffic = snapshot?.health?.traffic;

  // No wrapper margin here: the cards bring their own mt-2 and the callouts
  // set mt="3", so a wrapper would stack a second gap on top.
  return (
    <>
      {blocker}
      {!blocker && snapshot && traffic?.dimension?.dim_exposure_date ? (
        <HealthSnapshotCards
          experiment={experiment}
          snapshot={snapshot}
          traffic={traffic}
          phase={phase}
          datasource={datasource ?? null}
          exposureQuery={exposureQuery}
          healthIssues={healthIssues}
          handleHealthNotification={handleHealthNotification}
          healthTabConfigParams={healthTabConfigParams}
          hasPermissionToConfigHealthTag={hasPermissionToConfigHealthTag}
          isBandit={isBandit}
          isHoldout={isHoldout}
          showMultipleExposures={showMultipleExposures}
          decisionFrameworkEnabled={decisionFrameworkEnabled}
        />
      ) : null}
      <ExposureLogsCard
        key={[
          experiment.id,
          experiment.datasource,
          experiment.exposureQueryId,
          experiment.exposureQueryIdentifierType ?? "",
          phase,
        ].join("-")}
        experiment={experiment}
        isTabActive={isTabActive}
        phase={phase}
      />
    </>
  );
}

const numberFormatter = new Intl.NumberFormat();

function HealthSnapshotCards({
  experiment,
  snapshot,
  traffic,
  phase,
  datasource,
  exposureQuery,
  healthIssues,
  handleHealthNotification,
  healthTabConfigParams,
  hasPermissionToConfigHealthTag,
  isBandit,
  isHoldout,
  showMultipleExposures,
  decisionFrameworkEnabled,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  traffic: ExperimentSnapshotTraffic;
  phase: number;
  datasource: DataSourceInterfaceWithParams | null;
  exposureQuery?: ExposureQuery;
  healthIssues: IssueValue[];
  handleHealthNotification: (issue: IssueValue) => void;
  healthTabConfigParams: HealthTabConfigParams;
  hasPermissionToConfigHealthTag: boolean;
  isBandit: boolean;
  isHoldout: boolean;
  showMultipleExposures: boolean;
  decisionFrameworkEnabled?: boolean;
}) {
  const totalUsers =
    traffic.overall?.variationUnits?.reduce((acc, a) => acc + a, 0) ?? 0;

  const clusterTraffic =
    snapshot.settings.isClusterExperiment && snapshot.health?.clusterTraffic
      ? snapshot.health?.clusterTraffic
      : null;
  const srmTraffic = clusterTraffic ?? traffic;
  const srmTotalUsers =
    srmTraffic?.overall?.variationUnits?.reduce((acc, a) => acc + a, 0) ?? 0;

  const clusterId = snapshot.settings.exposureQueryIdentifierType;
  const subUnitId = snapshot.settings.clusterSubUnitIdentifier;
  const clusterIds =
    snapshot.settings.isClusterExperiment && clusterId && subUnitId
      ? { cluster: clusterId, subUnit: subUnitId }
      : null;
  const clusterAssignment = snapshot.health?.clusterAssignment;
  const clusterSubUnitMapping = snapshot.health?.clusterSubUnitMapping;
  const oneMixedCluster = clusterAssignment?.mixedClusters === 1;
  const oneMultiClusterUnit = clusterSubUnitMapping?.multiClusterUnits === 1;
  // "1 of 25 region_id values": the noun follows the total, the verb the count.
  const clusterNoun =
    clusterAssignment?.totalClusters === 1 ? "value" : "values";
  const subUnitNoun =
    clusterSubUnitMapping?.totalUnits === 1 ? "value" : "values";

  const phaseObj = experiment.phases?.[phase];

  const variations = getLatestPhaseVariations(experiment).map((v, i) => {
    return {
      id: v.key || v.index + "",
      index: v.index,
      name: v.name,
      weight: phaseObj?.variationWeights?.[i] || 0,
    };
  });

  return (
    <div className="mt-2">
      <IssueTags issues={healthIssues} />
      <TrafficCard
        traffic={traffic}
        variations={variations}
        isBandit={isBandit}
        cluster={
          snapshot.settings.isClusterExperiment &&
          snapshot.settings.exposureQueryIdentifierType &&
          snapshot.settings.clusterSubUnitIdentifier
            ? {
                identifier: snapshot.settings.exposureQueryIdentifierType,
                subUnitIdentifier: snapshot.settings.clusterSubUnitIdentifier,
                traffic: snapshot.health?.clusterTraffic,
              }
            : undefined
        }
      />
      <div id="balanceCheck" style={{ scrollMarginTop: "100px" }}>
        {!isBandit ? (
          <SRMCard
            traffic={srmTraffic}
            variations={variations}
            totalUsers={srmTotalUsers}
            onNotify={handleHealthNotification}
            dataSource={datasource}
            exposureQuery={exposureQuery}
            healthTabConfigParams={healthTabConfigParams}
            canConfigHealthTab={hasPermissionToConfigHealthTag}
          />
        ) : (
          <BanditSRMCard
            experiment={experiment}
            snapshot={snapshot}
            phase={phaseObj}
            onNotify={handleHealthNotification}
          />
        )}
      </div>
      {!isBandit && snapshot.settings.regressionAdjustmentEnabled && (
        <div id="covariateBalanceCheck" style={{ scrollMarginTop: "100px" }}>
          <CovariateImbalanceCard
            experiment={experiment}
            variations={variations}
            snapshot={snapshot}
            onNotify={handleHealthNotification}
          />
        </div>
      )}
      {showMultipleExposures && (
        <div id="multipleExposures" style={{ scrollMarginTop: "100px" }}>
          <MultipleExposuresCard
            totalUsers={totalUsers}
            onNotify={handleHealthNotification}
            snapshot={snapshot}
          />
        </div>
      )}

      {clusterIds && clusterAssignment ? (
        <div id="clusterAssignment" style={{ scrollMarginTop: "100px" }}>
          <ClusterIssueCard
            id="clusterAssignment"
            title="Cluster Assignment Check"
            description={
              <>
                Detects whether every{" "}
                <IdentifierCode>{clusterIds.subUnit}</IdentifierCode> in a{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode> saw the
                same variation
              </>
            }
            affectedCount={clusterAssignment.mixedClusters}
            totalCount={clusterAssignment.totalClusters}
            error={clusterAssignment.error}
            onNotify={handleHealthNotification}
            healthyMessage={
              <b>
                Every <IdentifierCode>{clusterIds.cluster}</IdentifierCode> had
                a single variation.
              </b>
            }
            belowThresholdMessage={(threshold, share) => (
              <>
                {numberFormatter.format(clusterAssignment.mixedClusters)} of{" "}
                {numberFormatter.format(clusterAssignment.totalClusters)}{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode>{" "}
                {clusterNoun} ({share}) had{" "}
                <IdentifierCode>{clusterIds.subUnit}</IdentifierCode> values in
                more than one variation and {oneMixedCluster ? "was" : "were"}{" "}
                removed from results, but that is below your threshold of{" "}
                {threshold}.
              </>
            )}
            warningMessage={(share) => (
              <>
                <strong>Cluster Assignment Warning</strong>.{" "}
                {numberFormatter.format(clusterAssignment.mixedClusters)} of{" "}
                {numberFormatter.format(clusterAssignment.totalClusters)}{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode>{" "}
                {clusterNoun} ({share}) had{" "}
                <IdentifierCode>{clusterIds.subUnit}</IdentifierCode> values in
                more than one variation and {oneMixedCluster ? "was" : "were"}{" "}
                automatically removed from results. Check that the{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode> in your
                assignment query matches the attribute the SDK hashes on.
              </>
            )}
          />
        </div>
      ) : null}
      {clusterIds && clusterSubUnitMapping ? (
        <div id="clusterMapping" style={{ scrollMarginTop: "100px" }}>
          <ClusterIssueCard
            id="clusterMapping"
            title="Cluster Mapping Check"
            description={
              <>
                Detects whether each{" "}
                <IdentifierCode>{clusterIds.subUnit}</IdentifierCode> belongs to
                only one <IdentifierCode>{clusterIds.cluster}</IdentifierCode>
              </>
            }
            affectedCount={clusterSubUnitMapping.multiClusterUnits}
            totalCount={clusterSubUnitMapping.totalUnits}
            error={clusterSubUnitMapping.error}
            onNotify={handleHealthNotification}
            healthyMessage={
              <b>
                Every <IdentifierCode>{clusterIds.subUnit}</IdentifierCode>{" "}
                mapped to one{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode>.
              </b>
            }
            belowThresholdMessage={(threshold, share) => (
              <>
                {numberFormatter.format(
                  clusterSubUnitMapping.multiClusterUnits,
                )}{" "}
                of {numberFormatter.format(clusterSubUnitMapping.totalUnits)}{" "}
                <IdentifierCode>{clusterIds.subUnit}</IdentifierCode>{" "}
                {subUnitNoun} ({share}) appeared in more than one{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode> and{" "}
                {oneMultiClusterUnit ? "was" : "were"} removed from results, but
                that is below your threshold of {threshold}.
              </>
            )}
            warningMessage={(share) => (
              <>
                <strong>Cluster Mapping Warning</strong>.{" "}
                {numberFormatter.format(
                  clusterSubUnitMapping.multiClusterUnits,
                )}{" "}
                of {numberFormatter.format(clusterSubUnitMapping.totalUnits)}{" "}
                <IdentifierCode>{clusterIds.subUnit}</IdentifierCode>{" "}
                {subUnitNoun} ({share}) appeared in more than one{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode> and{" "}
                {oneMultiClusterUnit ? "was" : "were"} automatically removed
                from results. Check that{" "}
                <IdentifierCode>{clusterIds.cluster}</IdentifierCode> is a
                stable grouping for each{" "}
                <IdentifierCode>{clusterIds.subUnit}</IdentifierCode>.
              </>
            )}
          />
        </div>
      ) : null}
      {clusterIds && clusterTraffic ? (
        <div id="clusterReliability" style={{ scrollMarginTop: "100px" }}>
          <ClusterReliabilityCard
            clusterTraffic={clusterTraffic}
            variations={variations}
            clusterIdentifier={clusterIds.cluster}
            subUnitIdentifier={clusterIds.subUnit}
            onNotify={handleHealthNotification}
          />
        </div>
      ) : null}

      {!isBandit &&
      !isHoldout &&
      (decisionFrameworkEnabled ?? DEFAULT_DECISION_FRAMEWORK_ENABLED) ? (
        <PowerCard
          experiment={experiment}
          snapshot={snapshot}
          onNotify={handleHealthNotification}
        />
      ) : null}
    </div>
  );
}
