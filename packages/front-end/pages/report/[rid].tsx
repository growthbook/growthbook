import { useRouter } from "next/router";
import { ReportInterface } from "back-end/types/report";
import React, { useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { IdeaInterface } from "shared/types/idea";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ReportResults from "@/components/Report/ReportResults";
import ReportMetaInfo from "@/components/Report/ReportMetaInfo";
import LegacyReportPage from "@/components/Report/LegacyReportPage";
import { useDefinitions } from "@/services/DefinitionsContext";
import ConfigureReport from "@/components/Report/ConfigureReport";

export default function ReportPage() {
  const router = useRouter();
  const { userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const { getDatasourceById } = useDefinitions();

  const [editAnalysisOpen, setEditAnalysisOpen] = useState(false);

  const { rid } = router.query;
  const { data, error, mutate } = useApi<{ report: ReportInterface }>(
    `/report/${rid}`,
  );
  const report = data?.report;
  const loading = !data;

  const { data: experimentData } = useApi<{
    experiment: ExperimentInterfaceStringDates;
    idea?: IdeaInterface;
    visualChangesets: VisualChangesetInterface[];
  }>(`/experiment/${data?.report?.experimentId}`, {
    shouldRun: () => !!data?.report?.experimentId,
  });
  const experiment = experimentData?.experiment;
  const datasource = experiment?.datasource
    ? getDatasourceById(experiment.datasource) || undefined
    : undefined;

  const snapshotId =
    report?.type === "experiment-snapshot" ? report?.snapshot : undefined;

  const {
    data: snapshotData,
    error: snapshotError,
    mutate: mutateSnapshot,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/snapshot/${snapshotId}`, {
    shouldRun: () => !!snapshotId,
  });
  const snapshot = snapshotData?.snapshot;

  const runQueriesButtonRef = useRef<HTMLButtonElement>(null);

  if (!data) {
    return <LoadingOverlay />;
  }
  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!report) {
    return null;
  }
  if (report.type === "experiment") {
    return (
      <LegacyReportPage
        report={report}
        loading={loading}
        error={error}
        mutate={mutate}
      />
    );
  }

  if (report.type !== "experiment-snapshot") {
    return null;
  }

  const canUpdateReport = experiment
    ? permissionsUtil.canViewReportModal(experiment.project)
    : false;
  const isOwner = userId === report?.userId || !report?.userId;
  const isAdmin = permissionsUtil.canSuperDeleteReport();
  const canEdit =
    isOwner ||
    isAdmin ||
    (report.editLevel === "organization" && canUpdateReport);
  const canDelete = isOwner || isAdmin;

  const isBandit = experiment?.type === "multi-armed-bandit";
  const isHoldout = experiment?.type === "holdout";

  return (
    <div className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          {
            display: isBandit
              ? `Bandits`
              : isHoldout
                ? `Holdouts`
                : `Experiments`,
            href: isBandit
              ? `/bandits`
              : isHoldout
                ? `/holdouts`
                : `/experiments`,
          },
          {
            display: `${experiment?.name ?? "Report"}`,
            href: !isHoldout
              ? experiment?.id
                ? `/${isBandit ? `bandit` : `experiment`}/${experiment.id}`
                : undefined
              : experiment.holdoutId
                ? `/holdout/${experiment.holdoutId}`
                : undefined,
          },
          { display: report.title },
        ]}
      />

      <ReportMetaInfo
        report={report}
        snapshot={snapshot ?? undefined}
        experiment={experiment}
        datasource={datasource}
        mutate={mutate}
        isOwner={isOwner}
        isAdmin={isAdmin}
        canEdit={canEdit}
        canDelete={canDelete}
        showEditControls={true}
      />

      {editAnalysisOpen && (
        <ConfigureReport
          report={report}
          mutate={mutate}
          close={() => setEditAnalysisOpen(false)}
          runQueriesButtonRef={runQueriesButtonRef}
          canEdit={canEdit}
        />
      )}

      <ReportResults
        report={report}
        snapshot={snapshot}
        snapshotError={
          snapshotError
            ? snapshotError
            : snapshot?.error
              ? new Error(snapshot.error)
              : snapshot?.status === "error"
                ? new Error("Report analysis failed")
                : undefined
        }
        mutateReport={mutate}
        mutateSnapshot={mutateSnapshot}
        canEdit={canEdit}
        setEditAnalysisOpen={setEditAnalysisOpen}
        runQueriesButtonRef={runQueriesButtonRef}
        showDetails={true}
      />
    </div>
  );
}
