import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import React, { useEffect, useState } from "react";
import { PiLink, PiCheck } from "react-icons/pi";
import { Text } from "@radix-ui/themes";
import { FaGear } from "react-icons/fa6";
import { date } from "shared/dates";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import { getSnapshotAnalysis } from "shared/util";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Button from "@/components/Radix/Button";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useAuth } from "@/services/auth";
import LinkButton from "@/components/Radix/LinkButton";
import SplitButton from "@/components/Radix/SplitButton";
import Badge from "@/components/Radix/Badge";
import { useUser } from "@/services/UserContext";
import HelperText from "@/components/Radix/HelperText";
import Markdown from "@/components/Markdown/Markdown";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import SelectField from "@/components/Forms/SelectField";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/components/Radix/Callout";
import ReportResultMoreMenu from "@/components/Report/ReportResultMoreMenu";
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Link from "@/components/Radix/Link";
import ConditionalWrapper from "@/components/ConditionalWrapper";

type ShareLevel = "public" | "organization" | "private";
type EditLevel = "organization" | "private";

export default function ReportMetaInfo({
  report,
  snapshot,
  experiment,
  datasource,
  mutate,
  canView = true,
  isOwner,
  isAdmin,
  canEdit,
  canDelete,
  showEditControls,
  showPrivateLink,
}: {
  report: ExperimentSnapshotReportInterface;
  snapshot?: ExperimentSnapshotInterface;
  experiment?: Partial<ExperimentInterfaceStringDates>;
  datasource?: DataSourceInterfaceWithParams;
  mutate?: () => Promise<unknown> | unknown;
  canView?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  showEditControls?: boolean;
  showPrivateLink?: boolean;
}) {
  const HOST = globalThis?.window?.location?.origin;
  const shareableLink = report.tinyid
    ? `${HOST}/r/${report.tinyid}`
    : `${HOST}/report/${report.id}`;

  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });

  const [generalModalOpen, setGeneralModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const [shareLevel, setShareLevel] = useState<ShareLevel>(
    report.shareLevel || "organization"
  );
  const [saveShareLevelStatus, setSaveShareLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);

  const [editLevel, setEditLevel] = useState<EditLevel>(
    report.editLevel || "organization"
  );
  const [saveEditLevelStatus, setSaveEditLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);

  const generalForm = useForm<Partial<ExperimentSnapshotReportInterface>>({
    defaultValues: {
      title: report.title ?? "",
      description: report.description ?? "",
    },
  });

  // Report/snapshot info for dropdown menu controls
  const variations = report.experimentMetadata.variations.map(
    (variation, i) => ({
      id: variation.id,
      name: variation.name,
      weight:
        report.experimentMetadata.phases?.[snapshot?.phase || 0]
          ?.variationWeights?.[i] || 1 / (variations?.length || 2),
    })
  );
  const analysis = snapshot
    ? getSnapshotAnalysis(snapshot) ?? undefined
    : undefined;
  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  useEffect(() => {
    if (report.shareLevel !== shareLevel) {
      console.log({ r: report.shareLevel, shareLevel });
      setSaveShareLevelStatus("loading");
      apiCall<{
        updatedReport: ExperimentSnapshotReportInterface;
      }>(`/report/${report.id}`, {
        method: "PUT",
        body: JSON.stringify({ shareLevel }),
      })
        .then(() => {
          mutate?.();
          setSaveShareLevelStatus("success");
          setTimeout(() => setSaveShareLevelStatus(null), 1500);
        })
        .catch(() => {
          setSaveShareLevelStatus("fail");
          setTimeout(() => setSaveShareLevelStatus(null), 1500);
        });
    }
  }, [
    report.id,
    report.shareLevel,
    shareLevel,
    mutate,
    setSaveEditLevelStatus,
    apiCall,
  ]);

  useEffect(() => {
    if (report.editLevel !== editLevel) {
      setSaveEditLevelStatus("loading");
      apiCall<{
        updatedReport: ExperimentSnapshotReportInterface;
      }>(`/report/${report.id}`, {
        method: "PUT",
        body: JSON.stringify({ editLevel }),
      })
        .then(() => {
          mutate?.();
          setSaveEditLevelStatus("success");
          setTimeout(() => setSaveEditLevelStatus(null), 1500);
        })
        .catch(() => {
          setSaveEditLevelStatus("fail");
          setTimeout(() => setSaveEditLevelStatus(null), 1500);
        });
    }
  }, [
    report.id,
    report.editLevel,
    editLevel,
    mutate,
    setSaveEditLevelStatus,
    apiCall,
  ]);

  const shareLinkButton = copySuccess ? (
    <Button style={{ width: 150 }} icon={<PiCheck />}>
      Link copied
    </Button>
  ) : (
    <Button
      icon={<PiLink />}
      onClick={() => {
        if (!copySuccess) performCopy(shareableLink);
        setTimeout(() => setShareModalOpen(false), 810);
      }}
      disabled={shareLevel === "private"}
      style={{ width: 150 }}
    >
      Copy Link
    </Button>
  );

  const shareLinkButtonTiny =
    copySuccess && !shareModalOpen ? (
      <Button>
        <Tooltip
          state={true}
          body="Link copied"
          style={{ pointerEvents: "none" }}
          tipMinWidth="80"
        >
          <PiCheck />
        </Tooltip>
      </Button>
    ) : (
      <Button onClick={() => performCopy(shareableLink)}>
        <PiLink />
      </Button>
    );

  return (
    <>
      <div className="mt-1 mb-3">
        <div className="d-flex">
          <div className="flex-1">
            <h1>{report.title}</h1>

            {experiment ? (
              <div className="d-flex mb-2">
                <Text size="2" color="gray" mr="2">
                  Ad-hoc report for{" "}
                  {experiment?.type === "multi-armed-bandit"
                    ? "Bandit"
                    : "Experiment"}
                  :
                </Text>
                <ConditionalWrapper
                  condition={
                    !!experiment?.id &&
                    (!!showPrivateLink || !!showEditControls)
                  }
                  wrapper={
                    <Link
                      href={`/${
                        experiment?.type === "multi-armed-bandit"
                          ? "bandit"
                          : "experiment"
                      }/${experiment?.id}`}
                    />
                  }
                >
                  {experiment?.name || experiment?.id || "(unknown experiment)"}
                </ConditionalWrapper>
              </div>
            ) : null}

            <div>
              <Text size="1" color="gray">
                Report created{" "}
                {showEditControls && report?.userId ? (
                  <>by {getUserDisplay(report.userId)} </>
                ) : null}{" "}
                on {date(report.dateCreated)}
              </Text>
              {showEditControls && (
                <>
                  <div className="d-inline-block ml-2">
                    {report.shareLevel === "private" ? (
                      <Badge
                        variant="soft"
                        color="gray"
                        label="Private"
                        radius="full"
                      />
                    ) : report.shareLevel === "organization" ? (
                      <Badge variant="soft" label="Published" radius="full" />
                    ) : report.shareLevel === "public" ? (
                      <Badge
                        variant="soft"
                        color="orange"
                        label="Public"
                        radius="full"
                      />
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
          {canView ? (
            <div className="flex-shrink-0">
              <div className="d-flex">
                {showEditControls ? (
                  <div className="d-flex flex-column align-items-end">
                    {shareLevel === "private" ? (
                      <Button onClick={() => setShareModalOpen(true)} size="sm">
                        Share...
                      </Button>
                    ) : (
                      <SplitButton menu={shareLinkButtonTiny}>
                        <Button onClick={() => setShareModalOpen(true)}>
                          Share...
                        </Button>
                      </SplitButton>
                    )}
                  </div>
                ) : (
                  shareLinkButton
                )}
                {showEditControls ? (
                  <ReportResultMoreMenu
                    report={report}
                    hasData={hasData}
                    supportsNotebooks={!!datasource?.settings?.notebookRunQuery}
                    notebookUrl={`/report/${report.id}/notebook`}
                    notebookFilename={report.title}
                    queries={snapshot?.queries}
                    queryError={snapshot?.error}
                    results={analysis?.results}
                    variations={variations}
                    metrics={
                      snapshot?.settings
                        ? getAllMetricIdsFromExperiment(
                            snapshot.settings,
                            false
                          )
                        : undefined
                    }
                    trackingKey={report.title}
                    dimension={snapshot?.dimension ?? undefined}
                    setNameModalOpen={canEdit ? setGeneralModalOpen : undefined}
                    canDelete={canDelete}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {showPrivateLink && (
          <div>
            <LinkButton
              size="xs"
              variant="ghost"
              href={`/report/${report.id}`}
              icon={<FaGear />}
            >
              Manage this report
            </LinkButton>
          </div>
        )}
      </div>

      <div className="mb-4">
        <Markdown>{report.description}</Markdown>
      </div>

      {generalModalOpen && (
        <Modal
          size="lg"
          open={true}
          trackingEventModalType="report-edit-name-description"
          close={() => {
            generalForm.reset();
            setGeneralModalOpen(false);
          }}
          submit={generalForm.handleSubmit(async (value) => {
            const { updatedReport } = await apiCall<{
              updatedReport: ExperimentSnapshotReportInterface;
            }>(`/report/${report.id}`, {
              method: "PUT",
              body: JSON.stringify(value),
            });
            if (updatedReport) {
              generalForm.reset({
                title: updatedReport.title ?? "",
                description: updatedReport.description ?? "",
              });
            }
            mutate?.();
          })}
          header={`Edit "${report.title}"`}
          useRadixButton={true}
        >
          <Field label="Report Name" {...generalForm.register("title")} />

          <label>Description</label>
          <MarkdownInput
            value={generalForm.watch("description") || ""}
            setValue={(v) => generalForm.setValue("description", v)}
          />
        </Modal>
      )}

      {shareModalOpen && (
        <Modal
          open={true}
          trackingEventModalType="share-report-settings"
          close={() => setShareModalOpen(false)}
          closeCta="Close"
          header={`Share "${report.title}"`}
          useRadixButton={true}
          secondaryCTA={shareLinkButton}
        >
          <div className="mb-3">
            {shareLevel === "organization" ? (
              <Callout status="info" size="sm">
                This report is discoverable within your organization.
              </Callout>
            ) : shareLevel === "public" ? (
              <>
                <Callout status="error" size="sm">
                  Anyone with the link can view this report, even those outside
                  your organization.
                </Callout>
              </>
            ) : shareLevel === "private" ? (
              <Callout status="info" size="sm">
                This report is currently unlisted
                {editLevel === "private" ? " — only you can view or edit" : ""}.
              </Callout>
            ) : null}
          </div>

          <SelectField
            label="View access"
            value={shareLevel}
            onChange={(v: ShareLevel) => setShareLevel(v)}
            containerClassName="mb-2"
            sort={false}
            disabled={!isOwner && !isAdmin}
            options={[
              { value: "organization", label: "Only organization members" },
              { value: "public", label: "Anyone with the link" },
              { value: "private", label: "Only me" },
            ]}
          />
          <div className="mb-1" style={{ height: 24 }}>
            {saveShareLevelStatus === "loading" ? (
              <div className="position-relative" style={{ top: -6 }}>
                <LoadingSpinner />
              </div>
            ) : saveShareLevelStatus === "success" ? (
              <HelperText status="success" size="sm">
                Sharing status has been updated
              </HelperText>
            ) : saveShareLevelStatus === "fail" ? (
              <HelperText status="error" size="sm">
                Unable to update sharing status
              </HelperText>
            ) : null}
          </div>

          <SelectField
            label="Edit access"
            value={editLevel}
            onChange={(v: EditLevel) => setEditLevel(v)}
            containerClassName="mb-2"
            sort={false}
            disabled={!isOwner && !isAdmin}
            options={[
              {
                value: "organization",
                label: "Any organization members with editing permissions",
              },
              { value: "private", label: "Only me" },
            ]}
          />
          <div className="mb-1" style={{ height: 24 }}>
            {saveEditLevelStatus === "loading" ? (
              <div className="position-relative" style={{ top: -6 }}>
                <LoadingSpinner />
              </div>
            ) : saveEditLevelStatus === "success" ? (
              <HelperText status="success" size="sm">
                Editing status has been updated
              </HelperText>
            ) : saveEditLevelStatus === "fail" ? (
              <HelperText status="error" size="sm">
                Unable to update editing status
              </HelperText>
            ) : null}
          </div>
        </Modal>
      )}
    </>
  );
}
