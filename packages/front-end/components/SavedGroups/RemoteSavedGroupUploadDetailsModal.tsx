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
  switch (status.type) {
    case "pending":
      return <Badge label="Validating" color="gray" />;
    case "valid":
      return (
        <Badge
          label={`Valid: ${status.idCount.toLocaleString()} IDs`}
          color="green"
        />
      );
    case "invalid":
      return (
        <Badge
          label={`Invalid: ${status.invalidLineCount.toLocaleString()} bad lines`}
          color="red"
        />
      );
  }
}

function describeLoad(status: Load["status"]): string {
  switch (status.type) {
    case "loading":
      return "Loading";
    case "loaded":
      return `Loaded ${status.rowCount.toLocaleString()} IDs`;
    case "invalid":
      return `Invalid (${status.invalidLineCount.toLocaleString()} bad lines)`;
    case "failed":
      return `Failed: ${status.error}`;
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
  if (!loads.length) return <Text color="text-low">Not reported</Text>;
  const labels: Record<Load["status"]["type"], string> = {
    loaded: "loaded",
    loading: "loading",
    invalid: "invalid",
    failed: "failed",
  };
  const parts = (Object.keys(labels) as Load["status"]["type"][])
    .map((type) => {
      const count = loads.filter((l) => l.status.type === type).length;
      return count ? `${count} ${labels[type]}` : null;
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

const LOAD_COUNT_DIFFERS =
  "The number of values loaded doesn't match the file. The file may contain duplicates, which are removed at load time.";

function LoadCountWarning() {
  return (
    <Tooltip content={LOAD_COUNT_DIFFERS}>
      {/* Focusable with a name, so keyboard and screen reader users get the note */}
      <span
        tabIndex={0}
        role="img"
        aria-label={LOAD_COUNT_DIFFERS}
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
  const { getUserDisplay } = useUser();
  const permissionsUtils = usePermissionsUtil();
  const { data } = useApi<{ keys: ApiKeyInterface[] }>("/keys", {
    shouldRun: () => permissionsUtils.canCreateApiKey(),
  });
  if (!createdBy) return <>Unknown</>;
  if (!createdBy.startsWith("key_")) {
    return <>{getUserDisplay(createdBy, true)}</>;
  }
  const description = data?.keys.find((k) => k.id === createdBy)?.description;
  if (!description) return <>API key</>;
  return (
    <Flex as="span" display="inline-flex" align="center" gap="1">
      {description}
      <Tooltip content="via API key">
        <span>
          <Badge variant="outline" label="API" size="xs" />
        </span>
      </Tooltip>
    </Flex>
  );
}

/** A store's load status, explaining a count that differs from the file's. */
function LoadStatusCell({ load, idCount }: { load: Load; idCount?: number }) {
  const { status } = load;
  return (
    <Flex align="center" gap="1">
      <Text>{describeLoad(status)}</Text>
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
      setDownloadError(`Could not download version ${version}: ${e.message}`);
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
        <Modal.Title>Version {version}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? (
          <Callout status="error" size="sm">
            Could not load this upload: {error.message}
          </Callout>
        ) : !upload || !status ? (
          <Text color="text-low">Loading...</Text>
        ) : (
          <>
            {!file && (
              <Callout status="warning" size="sm" mb="4">
                The file is missing from storage.
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
                  label: "Status",
                  value: <UploadStatusBadge status={status} />,
                },
                { label: "File name", value: upload.fileName ?? "Unnamed" },
                {
                  label: "Size",
                  value: `${formatByteSizeString(upload.size)} (${upload.size.toLocaleString()} bytes)`,
                },
                {
                  label: "Uploaded",
                  value: (
                    <>
                      {datetime(upload.dateCreated)} by{" "}
                      <Uploader createdBy={upload.createdBy} />
                    </>
                  ),
                },
                {
                  label: "Content type",
                  value: file?.contentType ?? "Unknown",
                },
                {
                  label: "Last modified in storage",
                  value: file?.lastModified
                    ? datetime(file.lastModified)
                    : "Unknown",
                },
                {
                  label: "SHA-256",
                  value: upload.sha256 ? (
                    <CopyableValue value={upload.sha256} />
                  ) : status.type === "pending" ? (
                    "Computed when validated"
                  ) : (
                    "Not available"
                  ),
                },
                {
                  label: "Checksum (ETag)",
                  value: file?.etag ? (
                    <CopyableValue value={file.etag} />
                  ) : (
                    "Unknown"
                  ),
                },
                ...(data.storageLocation
                  ? [
                      {
                        label: "Storage location",
                        value: <CopyableValue value={data.storageLocation} />,
                      },
                    ]
                  : []),
              ]}
            />

            {status.type === "invalid" && (
              <Box mb="4">
                <Heading as="h3" size="sm" mb="2">
                  Problems
                </Heading>
                <Flex direction="column" gap="1">
                  {status.errors.map((e, i) => (
                    <Text key={i} mono>
                      {e}
                    </Text>
                  ))}
                  {status.invalidLineCount > status.errors.length && (
                    <Text color="text-low">
                      and{" "}
                      {(
                        status.invalidLineCount - status.errors.length
                      ).toLocaleString()}{" "}
                      more
                    </Text>
                  )}
                </Flex>
              </Box>
            )}

            <Heading as="h3" size="sm" mb="2">
              Data Stores
            </Heading>
            {!upload.loads.length ? (
              <Text color="text-low">
                No data stores have reported on this upload.
              </Text>
            ) : (
              <Table variant="list">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Store</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                    <TableColumnHeader>Updated</TableColumnHeader>
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
            Close
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
                Delete
              </Button>
            </span>
          </Tooltip>
          <Button
            icon={<PiDownloadSimple />}
            disabled={!file}
            loading={downloadingVersion === version}
            onClick={() => download(version)}
          >
            Download CSV
          </Button>
        </Flex>
      </Modal.Footer>
    </Modal.Root>
  );
}
