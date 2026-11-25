import { useState } from "react";
import { datetime } from "shared/dates";
import { formatByteSizeString } from "shared/util";
import {
  ApiSavedGroupUpload,
  SavedGroupUploadDetails,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { PiDownloadSimple, PiTrash, PiWarningCircle } from "react-icons/pi";
import { ApiKeyInterface } from "shared/types/apikey";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Modal from "@/ui/Modal";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import DataList from "@/ui/DataList";
import Tooltip from "@/ui/Tooltip";
import CopyableValue from "@/components/SavedGroups/CopyableValue";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

type Load = ApiSavedGroupUpload["loads"][number];

export function UploadStatusBadge({
  status,
}: {
  status: ApiSavedGroupUpload["status"];
}) {
  const { t } = useLingui();
  switch (status.type) {
    case "pending":
      return <Badge label={t`Validating`} color="gray" />;
    case "valid": {
      const idCount = status.idCount.toLocaleString();
      return <Badge label={t`Valid: ${idCount} IDs`} color="green" />;
    }
    case "invalid": {
      const invalidLineCount = status.invalidLineCount.toLocaleString();
      return (
        <Badge label={t`Invalid: ${invalidLineCount} bad lines`} color="red" />
      );
    }
  }
}

function describeLoad(status: Load["status"], i18n: I18n): string {
  switch (status.type) {
    case "loading":
      return i18n._(msg`Loading`);
    case "loaded": {
      const rowCount = status.rowCount.toLocaleString();
      return i18n._(msg`Loaded ${rowCount} IDs`);
    }
    case "invalid": {
      const invalidLineCount = status.invalidLineCount.toLocaleString();
      return i18n._(msg`Invalid (${invalidLineCount} bad lines)`);
    }
    case "failed": {
      const error = status.error;
      return i18n._(msg`Failed: ${error}`);
    }
  }
}

/** How many data stores reached each load status, such as "2 loaded, 1 failed". */
export function LoadSummary({
  loads,
  idCount,
}: {
  loads: Load[];
  /** The file's ID count, to flag stores that loaded a different number. */
  idCount?: number;
}) {
  const { t } = useLingui();
  if (!loads.length) {
    return (
      <Text color="text-low">
        <Trans>Not reported</Trans>
      </Text>
    );
  }
  const labels: Record<Load["status"]["type"], (count: number) => string> = {
    loaded: (count) => t`${count} loaded`,
    loading: (count) => t`${count} loading`,
    invalid: (count) => t`${count} invalid`,
    failed: (count) => t`${count} failed`,
  };
  const parts = (Object.keys(labels) as Load["status"]["type"][])
    .map((type) => {
      const count = loads.filter((l) => l.status.type === type).length;
      return count ? labels[type](count) : null;
    })
    .filter(Boolean);
  const differs =
    idCount !== undefined &&
    loads.some(
      ({ status }) => status.type === "loaded" && status.rowCount !== idCount,
    );
  return (
    <Flex align="center" gap="1">
      <Text>{parts.join(", ")}</Text>
      {differs && <LoadCountWarning />}
    </Flex>
  );
}

const LOAD_COUNT_DIFFERS = msg`The number of values loaded doesn't match the file. The file may contain duplicates, which are removed at load time.`;

function LoadCountWarning() {
  const { i18n } = useLingui();
  const loadCountDiffers = i18n._(LOAD_COUNT_DIFFERS);
  return (
    <Tooltip content={loadCountDiffers}>
      {/* Focusable with a name, so keyboard and screen reader users get the note */}
      <span
        tabIndex={0}
        role="img"
        aria-label={loadCountDiffers}
        style={{ display: "inline-flex" }}
      >
        <PiWarningCircle style={{ color: "var(--amber-11)" }} />
      </span>
    </Tooltip>
  );
}

/** How often pages refresh while waiting for data stores to report. */
export const LOAD_REPORT_POLL_MS = 15000;

/**
 * Whether a valid upload is still waiting for data stores: none has loaded it,
 * or one is loading. Loaders report after validation, so pages keep polling.
 */
export function isAwaitingLoads(upload: ApiSavedGroupUpload): boolean {
  return (
    upload.status.type === "valid" &&
    (!upload.loads.some((l) => l.status.type === "loaded") ||
      upload.loads.some((l) => l.status.type === "loading"))
  );
}

/**
 * Who uploaded a version: a member's name, an API key's description with an
 * "API" badge (or "API key" when it has none or the viewer can't list keys),
 * or "Unknown" for uploads from before authorship was recorded. Keys are shown
 * like the activity log shows them.
 */
export function Uploader({ createdBy }: { createdBy: string }) {
  const { t } = useLingui();
  const { getUserDisplay } = useUser();
  const permissionsUtils = usePermissionsUtil();
  const { data } = useApi<{ keys: ApiKeyInterface[] }>("/keys", {
    shouldRun: () => permissionsUtils.canCreateApiKey(),
  });
  if (!createdBy) return <Trans>Unknown</Trans>;
  if (!createdBy.startsWith("key_")) {
    return <>{getUserDisplay(createdBy, true)}</>;
  }
  const description = data?.keys.find((k) => k.id === createdBy)?.description;
  if (!description) return <Trans>API key</Trans>;
  return (
    <Flex as="span" display="inline-flex" align="center" gap="1">
      {description}
      <Tooltip content={t`via API key`}>
        <span>
          <Badge variant="outline" label={t`API`} size="xs" />
        </span>
      </Tooltip>
    </Flex>
  );
}

/** A store's load status, explaining a count that differs from the file's. */
function LoadStatusCell({ load, idCount }: { load: Load; idCount?: number }) {
  const { i18n } = useLingui();
  const { status } = load;
  return (
    <Flex align="center" gap="1">
      <Text>{describeLoad(status, i18n)}</Text>
      {status.type === "loaded" &&
        idCount !== undefined &&
        status.rowCount !== idCount && <LoadCountWarning />}
    </Flex>
  );
}

/**
 * Downloads an upload's file. Each call gets a fresh signed URL, so a page
 * left open never uses an expired one.
 */
export function useDownloadUpload(savedGroupId: string) {
  const { t } = useLingui();
  const { apiCall } = useAuth();
  const [downloadingVersion, setDownloadingVersion] = useState<number | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const download = async (version: number) => {
    setDownloadingVersion(version);
    setDownloadError(null);
    try {
      const { url } = await apiCall<{ url: string }>(
        `/saved-groups/${savedGroupId}/uploads/${version}/download-url`,
      );
      window.location.assign(url);
    } catch (e) {
      const message = e.message;
      setDownloadError(t`Could not download version ${version}: ${message}`);
    } finally {
      setDownloadingVersion(null);
    }
  };

  return { download, downloadingVersion, downloadError };
}

/**
 * One upload's record, storage info and data store reports, with download and
 * delete. The caller decides whether it can be deleted and confirms it.
 */
export default function RemoteSavedGroupUploadDetailsModal({
  savedGroupId,
  version,
  deleteDisabledReason,
  onDelete,
  close,
}: {
  savedGroupId: string;
  version: number;
  deleteDisabledReason: string | null;
  onDelete: () => void;
  close: () => void;
}) {
  const { t } = useLingui();
  const { download, downloadingVersion, downloadError } =
    useDownloadUpload(savedGroupId);
  const { data, error } = useApi<SavedGroupUploadDetails>(
    `/saved-groups/${savedGroupId}/uploads/${version}`,
    {
      // Also while pending, so the check's result shows when it finishes
      refreshInterval: (latest) =>
        latest &&
        (latest.upload.status.type === "pending" ||
          isAwaitingLoads(latest.upload))
          ? LOAD_REPORT_POLL_MS
          : 0,
    },
  );

  const upload = data?.upload;
  const file = data?.file;
  const status = upload?.status;
  const loadErrorMessage = error?.message;
  const fileSize = upload ? formatByteSizeString(upload.size) : null;
  const byteCount = upload?.size.toLocaleString();
  const uploadedAt = upload ? datetime(upload.dateCreated) : null;
  const moreProblemCount =
    status?.type === "invalid"
      ? (status.invalidLineCount - status.errors.length).toLocaleString()
      : null;

  return (
    <Modal.Root
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      size="lg"
      trackingEventModalType="remote-saved-group-upload-details"
    >
      <Modal.Header>
        <Modal.Title>
          <Trans>Version {version}</Trans>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? (
          <Callout status="error" size="sm">
            <Trans>Could not load this upload: {loadErrorMessage}</Trans>
          </Callout>
        ) : !upload || !status ? (
          <Text color="text-low">
            <Trans>Loading...</Trans>
          </Text>
        ) : (
          <>
            {!file && (
              <Callout status="warning" size="sm" mb="4">
                <Trans>The file is missing from storage.</Trans>
              </Callout>
            )}
            {downloadError && (
              <Callout status="error" size="sm" mb="4">
                {downloadError}
              </Callout>
            )}
            <DataList
              columns={2}
              mb="4"
              data={[
                {
                  label: t`Status`,
                  value: <UploadStatusBadge status={status} />,
                },
                {
                  label: t`File name`,
                  value: upload.fileName ?? t`Unnamed`,
                },
                {
                  label: t`Size`,
                  value: t`${fileSize} (${byteCount} bytes)`,
                },
                {
                  label: t`Uploaded`,
                  value: (
                    <Trans>
                      {uploadedAt} by <Uploader createdBy={upload.createdBy} />
                    </Trans>
                  ),
                },
                {
                  label: t`Content type`,
                  value: file?.contentType ?? t`Unknown`,
                },
                {
                  label: t`Last modified in storage`,
                  value: file?.lastModified
                    ? datetime(file.lastModified)
                    : t`Unknown`,
                },
                {
                  label: "SHA-256",
                  value: upload.sha256 ? (
                    <CopyableValue value={upload.sha256} />
                  ) : status.type === "pending" ? (
                    t`Computed when validated`
                  ) : (
                    t`Not available`
                  ),
                },
                {
                  label: t`Checksum (ETag)`,
                  value: file?.etag ? (
                    <CopyableValue value={file.etag} />
                  ) : (
                    t`Unknown`
                  ),
                },
                ...(data.storageLocation
                  ? [
                      {
                        label: t`Storage location`,
                        value: <CopyableValue value={data.storageLocation} />,
                      },
                    ]
                  : []),
              ]}
            />

            {status.type === "invalid" && (
              <Box mb="4">
                <Heading as="h3" size="sm" mb="2">
                  <Trans>Problems</Trans>
                </Heading>
                <Flex direction="column" gap="1">
                  {status.errors.map((e, i) => (
                    <Text key={i} mono>
                      {e}
                    </Text>
                  ))}
                  {status.invalidLineCount > status.errors.length && (
                    <Text color="text-low">
                      <Trans>and {moreProblemCount} more</Trans>
                    </Text>
                  )}
                </Flex>
              </Box>
            )}

            <Heading as="h3" size="sm" mb="2">
              <Trans>Data Stores</Trans>
            </Heading>
            {!upload.loads.length ? (
              <Text color="text-low">
                <Trans>No data stores have reported on this upload.</Trans>
              </Text>
            ) : (
              <Table variant="list">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>
                      <Trans>Store</Trans>
                    </TableColumnHeader>
                    <TableColumnHeader>
                      <Trans>Status</Trans>
                    </TableColumnHeader>
                    <TableColumnHeader>
                      <Trans>Updated</Trans>
                    </TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upload.loads.map((load) => (
                    <TableRow key={load.storeId}>
                      <TableCell>
                        <CopyableValue value={load.storeId} />
                      </TableCell>
                      <TableCell>
                        <LoadStatusCell
                          load={load}
                          idCount={
                            status?.type === "valid"
                              ? status.idCount
                              : undefined
                          }
                        />
                      </TableCell>
                      <TableCell>{datetime(load.dateUpdated)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer justify="between">
        <Modal.Close>
          <Button variant="ghost" onClick={close}>
            <Trans>Close</Trans>
          </Button>
        </Modal.Close>
        <Flex gap="3">
          <Tooltip
            content={deleteDisabledReason ?? ""}
            enabled={!!deleteDisabledReason}
          >
            {/* A disabled button gets no hover events, so the tooltip wraps
                a span */}
            <span>
              <Button
                variant="outline"
                color="red"
                icon={<PiTrash />}
                disabled={!!deleteDisabledReason}
                onClick={onDelete}
              >
                <Trans>Delete</Trans>
              </Button>
            </span>
          </Tooltip>
          <Button
            icon={<PiDownloadSimple />}
            disabled={!file}
            loading={downloadingVersion === version}
            onClick={() => download(version)}
          >
            <Trans>Download CSV</Trans>
          </Button>
        </Flex>
      </Modal.Footer>
    </Modal.Root>
  );
}
