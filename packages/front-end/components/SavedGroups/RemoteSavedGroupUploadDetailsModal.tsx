import { useState } from "react";
import { datetime } from "shared/dates";
import { formatByteSizeString } from "shared/util";
import {
  ApiSavedGroupUpload,
  SavedGroupUploadDetails,
} from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { PiDownloadSimple, PiTrash } from "react-icons/pi";
import useApi from "@/hooks/useApi";
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

export function LoadStatus({ loads }: { loads: Load[] }) {
  if (!loads.length) return <Text color="text-low">Not reported</Text>;
  return (
    <Flex direction="column" gap="1">
      {loads.map(({ storeId, status, dateUpdated }) => (
        <Text key={storeId} title={datetime(dateUpdated)}>
          {storeId}: {describeLoad(status)}
        </Text>
      ))}
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
  const { getUserDisplay } = useUser();
  const { download, downloadingVersion, downloadError } =
    useDownloadUpload(savedGroupId);
  const { data, error } = useApi<SavedGroupUploadDetails>(
    `/saved-groups/${savedGroupId}/uploads/${version}`,
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
                  value: `${datetime(upload.dateCreated)} by ${getUserDisplay(upload.createdBy, true)}`,
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
                    <Text mono overflowWrap="anywhere">
                      {upload.sha256}
                    </Text>
                  ) : status.type === "pending" ? (
                    "Computed when validated"
                  ) : (
                    "Not available"
                  ),
                },
                {
                  label: "Checksum (ETag)",
                  value: file?.etag ? <Text mono>{file.etag}</Text> : "Unknown",
                },
                ...(data.storageLocation
                  ? [
                      {
                        label: "Storage location",
                        value: (
                          <Text mono overflowWrap="anywhere">
                            {data.storageLocation}
                          </Text>
                        ),
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
                      <TableCell>{load.storeId}</TableCell>
                      <TableCell>{describeLoad(load.status)}</TableCell>
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
