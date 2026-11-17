import { ClipboardEvent, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Screenshot } from "shared/types/experiment";
import clsx from "clsx";
import { Box, Flex } from "@radix-ui/themes";
import { PiProhibit, PiUploadSimple } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { UPLOAD_IMAGE_TYPES, uploadFile } from "@/services/files";
import LoadingSpinner from "@/components/LoadingSpinner";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import styles from "./ScreenshotUpload.module.scss";

type UploadProgress = { done: number; total: number };

const isImageType = (type: string) => UPLOAD_IMAGE_TYPES.includes(type);
const REJECTED_TYPE_MESSAGE = "Only PNG, JPEG or GIF images can be uploaded";

// Spread `getRootProps()` on the drop target and render `getInputProps()` and
// `ScreenshotUploadOverlay` inside it, and `ScreenshotUploadError` near it.
export function useScreenshotUpload({
  experiment,
  variation,
  onSuccess,
  attach = true,
  noClick = false,
  disabled = false,
  onPendingChange,
}: {
  experiment: string;
  variation: number;
  onSuccess: (screenshot: Screenshot) => void;
  // False only stores the file, leaving `onSuccess` to stage it.
  attach?: boolean;
  // For a target with its own controls, which opens the picker with `open`.
  noClick?: boolean;
  disabled?: boolean;
  // How many files are still uploading, for a form that waits on them.
  onPendingChange?: (pending: number) => void;
}) {
  const { apiCall } = useAuth();
  // Counts the whole run, so a second drop mid-upload extends it.
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const pending = progress ? progress.total - progress.done : 0;
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  // Cleared by the next drag or upload.
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setProgress((p) => ({
      done: p?.done ?? 0,
      total: (p?.total ?? 0) + files.length,
    }));

    for (const file of files) {
      try {
        const { fileURL } = await uploadFile(apiCall, file);

        if (attach) {
          await apiCall(
            `/experiment/${experiment}/variation/${variation}/screenshot`,
            {
              method: "PUT",
              body: JSON.stringify({
                url: fileURL,
                // TODO: allow customizing description
                description: "",
              }),
            },
          );
        }

        onSuccess({
          path: fileURL,
          description: "",
        });
      } catch (e) {
        setError(e.message);
      } finally {
        setProgress((p) =>
          !p || p.done + 1 >= p.total ? null : { ...p, done: p.done + 1 },
        );
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    if (disabled) return;
    const fileItems = Array.from(e.clipboardData.items || []).filter(
      (item) => item.kind === "file",
    );
    // Text pastes pass through untouched.
    if (!fileItems.length) return;

    e.preventDefault();
    const files = fileItems
      .filter((item) => isImageType(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (!files.length) {
      setError(REJECTED_TYPE_MESSAGE);
      return;
    }
    upload(files);
  };

  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      onDrop: upload,
      accept: UPLOAD_IMAGE_TYPES,
      onDragEnter: () => setError(null),
      // Some browsers hide the type until the drop, so the overlay can't warn.
      onDropRejected: () => setError(REJECTED_TYPE_MESSAGE),
      noClick,
      noKeyboard: noClick,
      disabled,
    });

  return {
    getRootProps,
    getInputProps,
    isDragActive,
    isDragReject,
    open,
    onPaste,
    progress,
    error,
  };
}

const overlayLayout = {
  direction: "column",
  align: "center",
  justify: "center",
  gap: "2",
  p: "2",
} as const;

// Covers its drop target, which has to be positioned.
export function ScreenshotUploadOverlay({
  dragging,
  rejecting,
  progress,
}: {
  dragging: boolean;
  rejecting: boolean;
  progress: UploadProgress | null;
}) {
  if (dragging && rejecting) {
    return (
      <Flex
        {...overlayLayout}
        className={clsx(styles.overlay, styles.rejecting)}
      >
        <PiProhibit size={20} />
        <Text weight="semibold" align="center">
          Only PNG, JPEG or GIF
        </Text>
      </Flex>
    );
  }
  if (dragging) {
    return (
      <Flex
        {...overlayLayout}
        className={clsx(styles.overlay, styles.dropping)}
      >
        <PiUploadSimple size={20} />
        <Text weight="semibold" align="center">
          Drop image here
        </Text>
      </Flex>
    );
  }
  if (!progress) return null;
  return (
    <Flex
      {...overlayLayout}
      className={clsx(styles.overlay, styles.uploading)}
      role="status"
    >
      <LoadingSpinner />
      <Text align="center">
        {progress.total === 1
          ? "Uploading image…"
          : `Uploading ${progress.done + 1} of ${progress.total}…`}
      </Text>
    </Flex>
  );
}

export function ScreenshotUploadError({ error }: { error: string | null }) {
  if (!error) return null;
  // Announced, since it often lands after the file picker has closed.
  return (
    <Box role="alert">
      <HelperText status="error" size="sm">
        {error}
      </HelperText>
    </Box>
  );
}
