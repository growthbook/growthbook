import { ExperimentSnapshotReportInterface } from "back-end/types/report";
import React, { useEffect, useRef, useState } from "react";
import { PiLink, PiCheck } from "react-icons/pi";
import { Flex, Text } from "@radix-ui/themes";
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
import track from "@/services/track";
import UserAvatar from "@/components/Avatar/UserAvatar";
import metaDataStyles from "@/components/Radix/Styles/Metadata.module.scss";
import Metadata from "@/components/Radix/Metadata";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";

type ShareLevel = "public" | "organization" | "private";
type EditLevel = "organization" | "private";
const SAVE_SETTING_TIMEOUT_MS = 3000;

export default function ReportMetaInfo({
  report,
  snapshot,
  experiment,
  datasource,
  mutate,
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
  isOwner?: boolean;
  isAdmin?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  showEditControls?: boolean;
  showPrivateLink?: boolean;
}) {
  const HOST = globalThis?.window?.location?.origin;
  const shareableLink = report.uid
    ? `${HOST}/public/r/${report.uid}`
    : `${HOST}/report/${report.id}`;

  const { apiCall } = useAuth();
  const { getUserDisplay } = useUser();
  const ownerName =
    (report.userId ? getUserDisplay(report.userId, false) : "") || "";

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
  const saveShareLevelTimeout = useRef<number | undefined>();

  const [editLevel, setEditLevel] = useState<EditLevel>(
    report.editLevel || "organization"
  );
  const [saveEditLevelStatus, setSaveEditLevelStatus] = useState<
    null | "loading" | "success" | "fail"
  >(null);
  const saveEditLevelTimeout = useRef<number | undefined>();

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
          ?.variationWeights?.[i] ||
        1 / (report.experimentMetadata?.variations?.length || 2),
    })
  );
  const analysis = snapshot
    ? getSnapshotAnalysis(snapshot) ?? undefined
    : undefined;
  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  useEffect(() => {
    if (report.shareLevel !== shareLevel) {
      setSaveShareLevelStatus("loading");
      window.clearTimeout(saveShareLevelTimeout.current);
      apiCall<{
        updatedReport: ExperimentSnapshotReportInterface;
      }>(`/report/${report.id}`, {
        method: "PUT",
        body: JSON.stringify({ shareLevel }),
      })
        .then(() => {
          mutate?.();
          setSaveShareLevelStatus("success");
          saveShareLevelTimeout.current = window.setTimeout(
            () => setSaveShareLevelStatus(null),
            SAVE_SETTING_TIMEOUT_MS
          );
        })
        .catch(() => {
          setSaveShareLevelStatus("fail");
          saveShareLevelTimeout.current = window.setTimeout(
            () => setSaveShareLevelStatus(null),
            SAVE_SETTING_TIMEOUT_MS
          );
        });
      track("Experiment Report: Set Share Level", {
        source: showEditControls ? "private report" : "public report",
        type: shareLevel,
      });
    }
  }, [
    report.id,
    report.shareLevel,
    shareLevel,
    mutate,
    setSaveShareLevelStatus,
    apiCall,
    showEditControls,
  ]);

  useEffect(() => {
    if (report.editLevel !== editLevel) {
      setSaveEditLevelStatus("loading");
      window.clearTimeout(saveEditLevelTimeout.current);
      apiCall<{
        updatedReport: ExperimentSnapshotReportInterface;
      }>(`/report/${report.id}`, {
        method: "PUT",
        body: JSON.stringify({ editLevel }),
      })
        .then(() => {
          mutate?.();
          setSaveEditLevelStatus("success");
          saveEditLevelTimeout.current = window.setTimeout(
            () => setSaveEditLevelStatus(null),
            1500
          );
        })
        .catch(() => {
          setSaveEditLevelStatus("fail");
          saveEditLevelTimeout.current = window.setTimeout(
            () => setSaveEditLevelStatus(null),
            1500
          );
        });
      track("Experiment Report: Set Edit Level", {
        source: showEditControls ? "private report" : "public report",
        type: editLevel,
      });
    }
  }, [
    report.id,
    report.editLevel,
    editLevel,
    mutate,
    setSaveEditLevelStatus,
    apiCall,
    showEditControls,
  ]);

  const shareLinkButton =
    report.shareLevel !== "public" ? null : copySuccess ? (
      <Button style={{ width: 150 }} icon={<PiCheck />}>
        Link copied
      </Button>
    ) : (
      <Button
        icon={<PiLink />}
        onClick={() => {
          if (!copySuccess) performCopy(shareableLink);
          setTimeout(() => setShareModalOpen(false), 810);
          track("Experiment Report: Click Copy Link", {
            source: showEditControls ? "private report" : "public report",
            type: shareLevel,
            action: "normal button",
          });
        }}
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
      <Button
        onClick={() => {
          performCopy(shareableLink);
          track("Experiment Report: Click Share URL", {
            source: showEditControls ? "private report" : "public report",
            type: shareLevel,
            action: "small button",
          });
        }}
      >
        <PiLink />
      </Button>
    );

  return (
    <>
      <div className="mb-3">
        <div className="d-flex">
          <div className="flex-1">
            <h1 className="mt-1 mb-3 mr-2">
              {report.title}
              {showEditControls && (
                <>
                  <div
                    className="d-inline-block ml-2 position-relative"
                    style={{ top: -2 }}
                  >
                    <ShareStatusBadge
                      shareLevel={report.shareLevel}
                      editLevel={report.editLevel}
                      isOwner={isOwner}
                    />
                  </div>
                </>
              )}
            </h1>

            <Flex gap="3" mt="2" mb="1">
              {showEditControls && (
                <Metadata
                  label="Report by"
                  value={
                    <>
                      {ownerName !== "" && (
                        <UserAvatar name={ownerName} size="sm" variant="soft" />
                      )}
                      <Text
                        weight="regular"
                        className={metaDataStyles.valueColor}
                        ml="1"
                      >
                        {ownerName === "" ? "None" : ownerName}
                      </Text>
                    </>
                  }
                />
              )}
              <Metadata
                label="Report created"
                value={date(report.dateCreated)}
              />
              <Metadata
                label={
                  experiment?.type === "multi-armed-bandit"
                    ? "Bandit"
                    : "Experiment"
                }
                value={
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
                    {experiment?.name ||
                      experiment?.id ||
                      "(unknown experiment)"}
                  </ConditionalWrapper>
                }
              />
            </Flex>
          </div>
          <div className="flex-shrink-0">
            <div className="d-flex">
              {showPrivateLink && (
                <LinkButton
                  variant="outline"
                  href={`/report/${report.id}`}
                  mr="4"
                >
                  Edit Report
                </LinkButton>
              )}
              {showEditControls ? (
                <div className="d-flex flex-column align-items-end">
                  {shareLevel === "public" ? (
                    <SplitButton menu={shareLinkButtonTiny}>
                      <Button onClick={() => setShareModalOpen(true)}>
                        Share...
                      </Button>
                    </SplitButton>
                  ) : (
                    <Button onClick={() => setShareModalOpen(true)}>
                      Share...
                    </Button>
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
                      ? getAllMetricIdsFromExperiment(snapshot.settings, false)
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
        </div>
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
                <Callout status="warning" size="sm">
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
              { value: "private", label: "Only me" },
              { value: "organization", label: "Only organization members" },
              { value: "public", label: "Anyone with the link" },
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
