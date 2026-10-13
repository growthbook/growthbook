import { useEffect, useRef, useState } from "react";
import { ago, datetime } from "shared/dates";
import { formatByteSizeString } from "shared/util";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  ApiSavedGroupUpload,
  SavedGroupUploadDetails,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiCheckCircleFill,
  PiCircle,
  PiDownloadSimple,
  PiTrash,
  PiUploadSimple,
} from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { getUploadMethod } from "@/services/env";
import { uploadToSignedUrl } from "@/services/files";
import { DocLink } from "@/components/DocLink";
import RemoteSavedGroupUploadDetailsModal, {
  LoadStatus,
  UploadStatusBadge,
  useDownloadUpload,
} from "@/components/SavedGroups/RemoteSavedGroupUploadDetailsModal";
import Modal from "@/ui/Modal";
import ModalForm, { useModalForm } from "@/ui/Modal/ModalForm";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
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

type UploadUrlResponse = {
  signedUrl: string;
  fields: Record<string, string> | null;
  fileKey: string;
  maxBytes: number;
};

const UPLOADS_PER_PAGE = 50;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { loading } = useModalForm();
  return (
    <Button type="submit" disabled={disabled} loading={loading}>
      Upload
    </Button>
  );
}

/** How often the upload modal checks whether a new upload is valid yet. */
const CHECK_INTERVAL_MS = 2000;

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
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [useWhenChecked, setUseWhenChecked] = useState(canUseVersion);
  const [checking, setChecking] = useState(false);
  // Stops waiting for the check once the modal is closed
  const closed = useRef(false);
  const closeModal = () => {
    closed.current = true;
    close();
  };

  // Waits for the background check of a new upload
  const waitForCheck = async (version: number) => {
    setChecking(true);
    try {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
        if (closed.current) return null;
        const { upload } = await apiCall<SavedGroupUploadDetails>(
          `/saved-groups/${savedGroup.id}/uploads/${version}`,
        );
        if (upload.status.type !== "pending") return upload.status;
      }
    } finally {
      setChecking(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    const target = await apiCall<UploadUrlResponse>(
      `/saved-groups/${savedGroup.id}/upload-url`,
      { method: "POST" },
    );
    if (file.size > target.maxBytes) {
      throw new Error(
        `The file is larger than ${formatByteSizeString(target.maxBytes)}.`,
      );
    }
    setProgress(0);
    try {
      await uploadToSignedUrl({
        signedUrl: target.signedUrl,
        fields: target.fields,
        file,
        contentType: "text/csv",
        onProgress: setProgress,
      });
    } finally {
      setProgress(null);
    }
    const { upload } = await apiCall<{ upload: ApiSavedGroupUpload }>(
      `/saved-groups/${savedGroup.id}/uploads`,
      {
        method: "POST",
        body: JSON.stringify({ fileKey: target.fileKey, fileName: file.name }),
      },
    );
    await onUploaded();
    if (!useWhenChecked) {
      closeModal();
      return;
    }

    const status =
      upload.status.type === "pending"
        ? await waitForCheck(upload.version)
        : upload.status;
    if (!status) return;
    await onUploaded();
    if (status.type === "invalid") {
      throw new Error(
        `Version ${upload.version} is invalid, so the group won't use it. See its details for the problems found.`,
      );
    }
    closeModal();
    onUseVersion(upload.version);
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
            Each upload should contain a complete list of values, not
            additions/deletions/deltas. Each successive upload will create a new
            version of the ID list, and will replace previous versions.
          </Text>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {canUseVersion && (
            <Box mt="3">
              <Checkbox
                label="Use this version once it's validated"
                value={useWhenChecked}
                setValue={setUseWhenChecked}
              />
            </Box>
          )}
          {checking && (
            <Text as="p" color="text-mid" mt="3">
              Validating the file. This takes a few seconds for small files, and
              longer for large ones. You can close this and choose the version
              later.
            </Text>
          )}
          {progress !== null && (
            <ProgressBar
              segments={[
                {
                  id: "upload",
                  weight: 100,
                  completion: Math.round(progress * 100),
                  color: "violet",
                },
              ]}
            />
          )}
        </Modal.Body>
        <Modal.Footer justify="between">
          <Modal.Close>
            <Button variant="ghost" onClick={closeModal}>
              {checking ? "Close" : "Cancel"}
            </Button>
          </Modal.Close>
          <SubmitButton disabled={!file} />
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}

/**
 * A check on the version the viewed revision uses. Other valid versions show
 * an empty circle that switches to them.
 */
// The check and the circle share one box, so they line up
const MARK_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
};

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
        <span style={{ ...MARK_STYLE, color: "var(--green-10)" }}>
          <PiCheckCircleFill size={20} aria-label={inUseLabel} />
        </span>
      </Tooltip>
    );
  }
  if (!canUse) return null;
  return (
    <Tooltip content={useDisabledReason ?? "Use this version"}>
      {/* A disabled button gets no hover events, so the tooltip wraps a span */}
      <span style={MARK_STYLE}>
        <Button
          variant="ghost"
          color="gray"
          size="sm"
          aria-label="Use this version"
          disabled={!!useDisabledReason}
          onClick={onUse}
          // Just the icon, so it lines up with the check
          style={{ padding: 0, margin: 0, height: "auto" }}
        >
          <PiCircle size={20} />
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
  viewing,
  viewedVersion,
  useVersionDisabledReason,
  onUseVersion,
}: {
  savedGroup: SavedGroupInterface;
  canUpload: boolean;
  /** Whether the page shows the live group, a draft, or another revision. */
  viewing: "live" | "draft" | "other";
  /** The upload version of the revision being viewed. */
  viewedVersion: number | undefined;
  useVersionDisabledReason: string | null;
  onUseVersion: (version: number) => void;
}) {
  const { getUserDisplay } = useUser();
  const { apiCall } = useAuth();
  const [uploadModal, setUploadModal] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState<number | null>(null);
  const [detailsVersion, setDetailsVersion] = useState<number | null>(null);
  const { download, downloadingVersion, downloadError } = useDownloadUpload(
    savedGroup.id,
  );
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<UploadsPage>(
    `/saved-groups/${savedGroup.id}/uploads?limit=${UPLOADS_PER_PAGE}&offset=${(page - 1) * UPLOADS_PER_PAGE}`,
    {
      // Uploads are checked in the background, so poll until they're done.
      refreshInterval: (latest) =>
        latest?.uploads.some((u) => u.status.type === "pending") ? 5000 : 0,
    },
  );
  // Deleting the last rows of the last page leaves it empty; go back a page
  const lastPage = Math.max(
    1,
    Math.ceil((data?.total ?? 0) / UPLOADS_PER_PAGE),
  );
  useEffect(() => {
    if (data && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);
  const liveVersion = savedGroup.currentUploadVersion;

  // The live and draft versions are always listed, even when they're on
  // another page, so they stay easy to find and manage.
  const pageUploads = data?.uploads ?? [];
  const pinnedVersions = [liveVersion, viewedVersion].filter(
    (v, i, all): v is number =>
      v !== undefined &&
      all.indexOf(v) === i &&
      !pageUploads.some((u) => u.version === v),
  );
  const { data: pinnedData, mutate: mutatePinned } = useApi<UploadsPage>(
    `/saved-groups/${savedGroup.id}/uploads?versions=${pinnedVersions.join(",")}`,
    { shouldRun: () => !!data && pinnedVersions.length > 0 },
  );
  const refresh = async () => {
    await Promise.all([mutate(), mutatePinned()]);
  };

  const localStorage = getUploadMethod() === "local";
  const uploadDisabledReason = localStorage
    ? "Uploads need S3 or Google Cloud Storage."
    : savedGroup.archived
      ? "You can't upload to an archived Saved Group."
      : !canUpload
        ? "You don't have permission to publish this Saved Group."
        : null;

  const uploads = [
    ...(pinnedVersions.length ? (pinnedData?.uploads ?? []) : []),
    ...pageUploads,
  ];
  // Deleted uploads aren't listed, so an old revision can name one
  const viewedVersionDeleted =
    viewedVersion !== undefined &&
    pinnedVersions.includes(viewedVersion) &&
    !!pinnedData &&
    !pinnedData.uploads.some((u) => u.version === viewedVersion);
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
            This group doesn&apos;t use an upload yet, so it targets no one.
            Select a version below.
          </Callout>
        )}
      {error ? (
        <Callout status="error" size="sm">
          Could not load uploads: {error.message}
        </Callout>
      ) : !data ? null : !data.total ? (
        <Callout status="info" size="sm">
          No uploads yet. Upload a CSV of IDs, or you can alternatively manage
          group membership data in your own storage infrastructure, and
          implement a resolver to lookup group membership.{" "}
          <DocLink docSection="remoteSavedGroups">View docs</DocLink>
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
                onClick={() => setDetailsVersion(upload.version)}
                style={{ cursor: "pointer" }}
              >
                {/* Its own click target, so it doesn't open the details */}
                <TableCell onClick={(e) => e.stopPropagation()}>
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
                </TableCell>
                <TableCell>
                  <Flex align="center" gap="2">
                    {upload.version}
                    {upload.version === liveVersion && (
                      <Badge label="Live" color="gray" />
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
                  {getUserDisplay(upload.createdBy, true)}
                </TableCell>
                <TableCell>
                  <LoadStatus loads={upload.loads} />
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
