import { useEffect, useRef, useState } from "react";
import { ago, datetime } from "shared/dates";
import { checkRemoteGroupCsvSample } from "@growthbook/remote-saved-groups-csv-parser";
import {
  formatByteSizeString,
  REMOTE_SAVED_GROUP_SAMPLE_BYTES,
} from "shared/util";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  ApiSavedGroupUpload,
  SavedGroupUploadDetails,
  SavedGroupUploadUrlResponse,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCheckCircleFill,
  PiDownloadSimple,
  PiTrash,
  PiUploadSimple,
} from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { getUploadMethod } from "@/services/env";
import { uploadToSignedUrl } from "@/services/files";
import { useAttributeSchema } from "@/services/features";
import { DocLink } from "@/components/DocLink";
import RemoteSavedGroupUploadDetailsModal, {
  LoadSummary,
  LOAD_REPORT_POLL_MS,
  isAwaitingLoads,
  Uploader,
  UploadStatusBadge,
  useDownloadUpload,
} from "@/components/SavedGroups/RemoteSavedGroupUploadDetailsModal";
import Modal, { useModalContext } from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Tooltip from "@/ui/Tooltip";
import { ProgressBar } from "@/ui/ProgressBar";
import Pagination from "@/ui/Pagination";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

type UploadsPage = { uploads: ApiSavedGroupUpload[]; total: number };

const UPLOADS_PER_PAGE = 50;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" disabled={disabled} loading={loading}>
      Upload
    </Button>
  );
}

/** Picks the CSV to upload. Choosing a file clears the last file's error. */
function CsvFileInput({
  file,
  setFile,
  disabled,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
  disabled: boolean;
}) {
  const { setError } = useModalContext();
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <Flex align="center" gap="3">
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          Choose CSV
        </Button>
        <Text color={file ? undefined : "text-low"}>
          {file?.name ?? "No file chosen"}
        </Text>
      </Flex>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        style={{ display: "none" }}
        onChange={(e) => {
          setError(null);
          setFile(e.target.files?.[0] ?? null);
          // Lets choosing the same file again (after fixing it) run this too
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}

/** How often the upload modal checks whether a new upload is valid yet. */
const CHECK_INTERVAL_MS = 2000;

/** Where a submitted upload is, from sending the file to its check passing. */
type UploadStage =
  | { type: "uploading"; progress: number }
  | { type: "saving" }
  | { type: "validating" }
  | { type: "valid"; version: number; idCount: number };

/**
 * The upload's progress: the file transfer, then the check. It keeps the same
 * lines through every stage, so the modal doesn't change size as the upload
 * moves along.
 */
function UploadProgress({ stage }: { stage: UploadStage }) {
  const percent =
    stage.type === "uploading" ? Math.round(stage.progress * 100) : 100;
  const label =
    stage.type === "uploading"
      ? "Uploading..."
      : stage.type === "saving"
        ? "Saving the upload..."
        : stage.type === "validating"
          ? "Validating the file..."
          : `File version ${stage.version} is ready, with ${stage.idCount.toLocaleString()} IDs`;
  const color = stage.type === "valid" ? "green" : "violet";
  return (
    <Box mt="3">
      {/* Announces each stage; the percentage is visual only, so it isn't
          read on every tick */}
      <Box role="status">
        <Text as="p" color="text-mid">
          {label}
          {stage.type === "uploading" && (
            <span aria-hidden="true"> {percent}%</span>
          )}
        </Text>
      </Box>
      {/* The check's part stays unfilled until the file is valid */}
      <ProgressBar
        segments={[
          { id: "upload", weight: 80, completion: percent, color },
          {
            id: "check",
            weight: 20,
            completion: stage.type === "valid" ? 100 : 0,
            color,
          },
        ]}
      />
    </Box>
  );
}

function UploadModal({
  savedGroup,
  canUseVersion,
  close,
  onUploaded,
  onUseVersion,
}: {
  savedGroup: SavedGroupInterface;
  /** Whether the user can switch the group to the new version. */
  canUseVersion: boolean;
  close: () => void;
  onUploaded: () => Promise<void>;
  onUseVersion: (version: number) => void;
}) {
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema(true);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<UploadStage | null>(null);
  // A file already in storage whose upload wasn't recorded yet. Retrying
  // submits the same key, so the file isn't sent again and the server can
  // finish an upload it recorded before failing.
  const staged = useRef<{ file: File; fileKey: string } | null>(null);
  // An upload recorded but not yet checked. If waiting for its check fails,
  // retrying resumes the check instead of sending the file again.
  const recorded = useRef<{ file: File; upload: ApiSavedGroupUpload } | null>(
    null,
  );
  // Stops waiting for validation once the modal is closed or unmounted. Set
  // again on mount, since a dev hot reload runs the cleanup without closing.
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);
  // Cancels the file transfer when the modal is closed during it
  const transfer = useRef<AbortController | null>(null);
  const closeModal = () => {
    closed.current = true;
    transfer.current?.abort();
    close();
  };

  // Waits for the background check of a new upload
  const waitForCheck = async (version: number) => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
      if (closed.current) return null;
      const { upload } = await apiCall<SavedGroupUploadDetails>(
        `/saved-groups/${savedGroup.id}/uploads/${version}`,
      );
      if (closed.current) return null;
      if (upload.status.type !== "pending") return upload.status;
    }
  };

  // Catches common mistakes, like extra columns, before a long upload. The
  // back end still checks the whole file afterwards.
  const checkStart = async (file: File) => {
    if (file.size === 0) throw new Error("The file is empty.");
    const attributeKey = savedGroup.attributeKey ?? "";
    const sample = await file
      .slice(0, REMOTE_SAVED_GROUP_SAMPLE_BYTES)
      .arrayBuffer();
    checkRemoteGroupCsvSample(new Uint8Array(sample), {
      attributeKey,
      numeric:
        attributeSchema.find((a) => a.property === attributeKey)?.datatype ===
        "number",
      start: true,
      end: file.size <= REMOTE_SAVED_GROUP_SAMPLE_BYTES,
    });
  };

  const sendToStorage = async (file: File) => {
    await checkStart(file);
    const target = await apiCall<SavedGroupUploadUrlResponse>(
      `/saved-groups/${savedGroup.id}/upload-url`,
      { method: "POST" },
    );
    if (file.size > target.maxBytes) {
      throw new Error(
        `The file is larger than ${formatByteSizeString(target.maxBytes)}.`,
      );
    }
    if (closed.current) return null;
    setStage({ type: "uploading", progress: 0 });
    transfer.current = new AbortController();
    try {
      await uploadToSignedUrl({
        signedUrl: target.signedUrl,
        fields: target.fields,
        file,
        contentType: "text/csv",
        onProgress: (progress) => setStage({ type: "uploading", progress }),
        signal: transfer.current.signal,
      });
    } finally {
      transfer.current = null;
    }
    return target.fileKey;
  };

  const upload = async () => {
    try {
      await uploadAndCheck();
    } catch (e) {
      // Closing cancels the upload; that's not an error to show
      if (closed.current) return;
      setStage(null);
      throw e;
    }
  };

  const uploadAndCheck = async () => {
    if (!file) return;
    let upload =
      recorded.current?.file === file ? recorded.current.upload : null;
    if (!upload) {
      if (staged.current?.file !== file) {
        const fileKey = await sendToStorage(file);
        if (fileKey === null) return;
        staged.current = { file, fileKey };
      }
      // Closed after the transfer finished: don't record the upload
      if (closed.current) return;
      setStage({ type: "saving" });
      ({ upload } = await apiCall<{ upload: ApiSavedGroupUpload }>(
        `/saved-groups/${savedGroup.id}/uploads`,
        {
          method: "POST",
          body: JSON.stringify({
            fileKey: staged.current.fileKey,
            fileName: file.name,
          }),
        },
      ));
      staged.current = null;
      recorded.current = { file, upload };
      await onUploaded();
    }

    setStage({ type: "validating" });
    const status =
      upload.status.type === "pending"
        ? await waitForCheck(upload.version)
        : upload.status;
    if (!status) return;
    recorded.current = null;
    await onUploaded();
    if (closed.current) return;
    if (status.type === "invalid") {
      throw new Error(
        "The file is invalid, so the group won't use it. See the upload's details for the problems found.",
      );
    }
    if (status.type === "valid") {
      // Waits for "Add to revision" or Close, so the next dialog doesn't open
      // on its own
      setStage({
        type: "valid",
        version: upload.version,
        idCount: status.idCount,
      });
    }
  };

  return (
    <Modal.Root
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeModal();
      }}
      trackingEventModalType="remote-saved-group-upload"
    >
      <ModalForm onSubmit={upload}>
        <Modal.Header>
          <Modal.Title>Upload IDs</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Text as="p" mb="3">
            Upload a CSV with one <code>{savedGroup.attributeKey}</code> value
            per line. A first line equal to the attribute name is skipped.
          </Text>
          <Text as="p" mb="3">
            Each upload is a complete list of values. Earlier uploads stay until
            you delete them.
          </Text>
          <CsvFileInput
            file={file}
            setFile={setFile}
            disabled={stage !== null}
          />
          {stage && <UploadProgress stage={stage} />}
        </Modal.Body>
        <Modal.Footer justify="between">
          {/* Saving is brief; closing then would still record the upload. A
              disabled button gets no hover events, so the tooltip wraps a span */}
          <Tooltip
            content="Saving the upload. This takes a moment."
            enabled={stage?.type === "saving"}
          >
            <span>
              <Modal.Close>
                <Button
                  variant="ghost"
                  disabled={stage?.type === "saving"}
                  onClick={closeModal}
                >
                  {stage?.type === "validating" || stage?.type === "valid"
                    ? "Close"
                    : "Cancel"}
                </Button>
              </Modal.Close>
            </span>
          </Tooltip>
          {stage?.type !== "valid" ? (
            <SubmitButton disabled={!file} />
          ) : (
            canUseVersion && (
              <Button
                onClick={() => {
                  closeModal();
                  onUseVersion(stage.version);
                }}
              >
                Add to revision
              </Button>
            )
          )}
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}

/**
 * A check on the version the viewed revision uses. Other valid versions show
 * a "Use" button that switches to them.
 */

function VersionMark({
  inUse,
  inUseLabel,
  canUse,
  useDisabledReason,
  onUse,
}: {
  inUse: boolean;
  inUseLabel: string;
  canUse: boolean;
  useDisabledReason: string | null;
  onUse: () => void;
}) {
  if (inUse) {
    return (
      <Tooltip content={inUseLabel}>
        <span style={{ display: "flex", color: "var(--green-10)" }}>
          <PiCheckCircleFill size={20} aria-label={inUseLabel} />
        </span>
      </Tooltip>
    );
  }
  if (!canUse) return null;
  return (
    <Tooltip content={useDisabledReason ?? "Use this version"}>
      {/* A disabled button gets no hover events, so the tooltip wraps a span */}
      <span>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Use this version"
          disabled={!!useDisabledReason}
          onClick={onUse}
        >
          Use
        </Button>
      </span>
    </Tooltip>
  );
}

/**
 * A remote group's uploaded versions, newest first, with an upload button.
 * The version the viewed revision uses is checked, and the live group's
 * version is marked Live; switching versions goes through `onUseVersion` (the
 * normal edit flow).
 */
export default function RemoteSavedGroupUploads({
  savedGroup,
  canUpload,
  planLockedReason,
  viewing,
  viewedVersion,
  useVersionDisabledReason,
  onUseVersion,
}: {
  savedGroup: SavedGroupInterface;
  canUpload: boolean;
  /** Why uploads are blocked by the org's plan, or null. Deleting still works. */
  planLockedReason: string | null;
  /** Whether the page shows the live group, a draft, or another revision. */
  viewing: "live" | "draft" | "other";
  /** The upload version of the revision being viewed. */
  viewedVersion: number | undefined;
  useVersionDisabledReason: string | null;
  onUseVersion: (version: number) => void;
}) {
  const { apiCall } = useAuth();
  const [uploadModal, setUploadModal] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState<number | null>(null);
  const [detailsVersion, setDetailsVersion] = useState<number | null>(null);
  const { download, downloadingVersion, downloadError } = useDownloadUpload(
    savedGroup.id,
  );
  const [page, setPage] = useState(1);
  const liveVersion = savedGroup.currentUploadVersion;
  // Uploads are checked in the background, and data stores report on the
  // live version after that, so poll until both are done. Only the live
  // version waits for loads; loaders skip the others.
  const pollInterval = (latest: UploadsPage | undefined) =>
    latest?.uploads.some((u) => u.status.type === "pending")
      ? 5000
      : latest?.uploads.some(
            (u) => u.version === liveVersion && isAwaitingLoads(u),
          )
        ? LOAD_REPORT_POLL_MS
        : 0;
  const { data, error, mutate } = useApi<UploadsPage>(
    `/saved-groups/${savedGroup.id}/uploads?limit=${UPLOADS_PER_PAGE}&offset=${(page - 1) * UPLOADS_PER_PAGE}`,
    { refreshInterval: pollInterval },
  );
  // Deleting the last rows of the last page leaves it empty; go back a page
  const lastPage = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / UPLOADS_PER_PAGE),
  );
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);

  // The live and viewed versions are fetched on every page, to tell whether
  // the viewed one was deleted. On the first page they're also listed when
  // they're on another page, so they stay easy to find; later pages read
  // newest first.
  const pageUploads = data?.uploads ?? [];
  const keyVersions = [liveVersion, viewedVersion].filter(
    (v, i, all): v is number => v !== undefined && all.indexOf(v) === i,
  );
  const { data: keyData, mutate: mutateKey } = useApi<UploadsPage>(
    `/saved-groups/${savedGroup.id}/uploads?versions=${keyVersions.join(",")}`,
    { shouldRun: () => keyVersions.length > 0, refreshInterval: pollInterval },
  );
  const refresh = async () => {
    await Promise.all([mutate(), mutateKey()]);
  };

  const localStorage = getUploadMethod() === "local";
  const uploadDisabledReason = localStorage
    ? "Uploads need S3 or Google Cloud Storage."
    : savedGroup.archived
      ? "You can't upload to an archived Saved Group."
      : !canUpload
        ? "You don't have permission to publish this Saved Group."
        : planLockedReason;

  const pinned =
    page === 1 && keyVersions.length
      ? (keyData?.uploads ?? []).filter(
          (u) => !pageUploads.some((p) => p.version === u.version),
        )
      : [];
  const uploads = [...pinned, ...pageUploads];
  // Deleted uploads aren't listed, so an old revision can name one
  const viewedVersionDeleted =
    viewedVersion !== undefined &&
    !!keyData &&
    !keyData.uploads.some((u) => u.version === viewedVersion);
  // The server also refuses versions other open drafts use
  const deleteDisabledReason = (version: number) =>
    !canUpload
      ? "You don't have permission to publish this Saved Group."
      : version === liveVersion
        ? "This is the group's current version."
        : viewing === "draft" && version === viewedVersion
          ? "The draft you're viewing uses this version."
          : null;

  return (
    <Box mb="4">
      {uploadModal && (
        <UploadModal
          savedGroup={savedGroup}
          canUseVersion={!useVersionDisabledReason}
          close={() => setUploadModal(false)}
          onUploaded={async () => {
            await refresh();
          }}
          onUseVersion={onUseVersion}
        />
      )}
      {deleteVersion !== null && (
        <ConfirmDialog
          title={`Delete version ${deleteVersion}?`}
          content="This deletes the upload and its file. It can't be undone."
          yesText="Delete"
          color="red"
          onCancel={() => setDeleteVersion(null)}
          onConfirm={async () => {
            await apiCall(
              `/saved-groups/${savedGroup.id}/uploads/${deleteVersion}`,
              { method: "DELETE" },
            );
            setDeleteVersion(null);
            await refresh();
          }}
        />
      )}
      {detailsVersion !== null && (
        <RemoteSavedGroupUploadDetailsModal
          savedGroupId={savedGroup.id}
          version={detailsVersion}
          deleteDisabledReason={deleteDisabledReason(detailsVersion)}
          onDelete={() => {
            setDetailsVersion(null);
            setDeleteVersion(detailsVersion);
          }}
          close={() => setDetailsVersion(null)}
        />
      )}
      <Flex align="center" justify="between" mb="3">
        <Heading size="md" as="h2" mb="0">
          Uploads
        </Heading>
        <Tooltip
          content={uploadDisabledReason ?? ""}
          enabled={!!uploadDisabledReason}
        >
          <span>
            <Button
              variant="outline"
              icon={<PiUploadSimple />}
              disabled={!!uploadDisabledReason}
              onClick={() => setUploadModal(true)}
            >
              Upload CSV
            </Button>
          </span>
        </Tooltip>
      </Flex>
      {downloadError && (
        <Callout status="error" size="sm" mb="3">
          {downloadError}
        </Callout>
      )}
      {viewedVersionDeleted && (
        <Callout status="warning" size="sm" mb="3">
          This revision uses version {viewedVersion}, which has been deleted.
        </Callout>
      )}
      {viewing !== "other" &&
        viewedVersion === undefined &&
        uploads.some((u) => u.status.type === "valid") && (
          <Callout status="warning" size="sm" mb="3">
            This group doesn&apos;t use an upload yet, so it targets no one. Use
            a version below.
          </Callout>
        )}
      {error ? (
        <Callout status="error" size="sm">
          Could not load uploads: {error.message}
        </Callout>
      ) : !data ? null : !data.total ? (
        <Callout status="info" size="sm">
          No uploads yet. Upload a CSV of IDs, or manage membership in your own
          storage. <DocLink docSection="remoteSavedGroups">View docs</DocLink>
        </Callout>
      ) : (
        <Table variant="list">
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: 40 }} />
              <TableColumnHeader>Version</TableColumnHeader>
              <TableColumnHeader>File</TableColumnHeader>
              <TableColumnHeader>Status</TableColumnHeader>
              <TableColumnHeader>Size</TableColumnHeader>
              <TableColumnHeader>Uploaded</TableColumnHeader>
              <TableColumnHeader>Data stores</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {uploads.map((upload) => (
              <TableRow
                key={upload.version}
                align="center"
                onClick={() => setDetailsVersion(upload.version)}
                style={{ cursor: "pointer" }}
              >
                {/* Its own click target, so it doesn't open the details */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {/* Centers the check and the Use button on each other */}
                  <Flex justify="center">
                    <VersionMark
                      inUse={upload.version === viewedVersion}
                      inUseLabel={
                        viewing === "live"
                          ? "The group uses this version."
                          : viewing === "draft"
                            ? "This draft uses this version."
                            : "This revision uses this version."
                      }
                      canUse={upload.status.type === "valid"}
                      useDisabledReason={useVersionDisabledReason}
                      onUse={() => onUseVersion(upload.version)}
                    />
                  </Flex>
                </TableCell>
                <TableCell>
                  <Flex align="center" gap="2">
                    {/* Rows aren't focusable, so the version opens details */}
                    <Link
                      color="dark"
                      aria-label={`Version ${upload.version} details`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDetailsVersion(upload.version);
                      }}
                    >
                      {upload.version}
                    </Link>
                    {upload.version === liveVersion && (
                      <Badge
                        label="Live"
                        color="green"
                        variant="solid"
                        radius="full"
                      />
                    )}
                  </Flex>
                </TableCell>
                <TableCell>
                  {upload.fileName ?? <Text color="text-low">Unnamed</Text>}
                </TableCell>
                <TableCell>
                  <UploadStatusBadge status={upload.status} />
                </TableCell>
                <TableCell>{formatByteSizeString(upload.size)}</TableCell>
                <TableCell title={datetime(upload.dateCreated)}>
                  {ago(upload.dateCreated)} by{" "}
                  <Uploader createdBy={upload.createdBy} />
                </TableCell>
                <TableCell>
                  <LoadSummary
                    loads={upload.loads}
                    idCount={
                      upload.status.type === "valid"
                        ? upload.status.idCount
                        : undefined
                    }
                  />
                </TableCell>
                {/* Its own click target, so it doesn't open the details */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Flex gap="3" align="center">
                    <Tooltip content="Download CSV">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Download version ${upload.version}`}
                        loading={downloadingVersion === upload.version}
                        onClick={() => download(upload.version)}
                      >
                        <PiDownloadSimple />
                      </Button>
                    </Tooltip>
                    <Tooltip
                      content={deleteDisabledReason(upload.version) ?? "Delete"}
                    >
                      {/* A disabled button gets no hover events, so the
                          tooltip wraps a span */}
                      <span>
                        <Button
                          variant="ghost"
                          color="red"
                          size="sm"
                          aria-label={`Delete version ${upload.version}`}
                          disabled={!!deleteDisabledReason(upload.version)}
                          onClick={() => setDeleteVersion(upload.version)}
                        >
                          <PiTrash />
                        </Button>
                      </span>
                    </Tooltip>
                  </Flex>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {(data?.total ?? 0) > UPLOADS_PER_PAGE && (
        <Pagination
          numItemsTotal={data?.total ?? 0}
          perPage={UPLOADS_PER_PAGE}
          currentPage={page}
          onPageChange={setPage}
        />
      )}
    </Box>
  );
}
