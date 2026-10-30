import { ClipboardEvent, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Screenshot } from "shared/types/experiment";
import clsx from "clsx";
import { Flex } from "@radix-ui/themes";
import { PiUploadSimple } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { uploadFile } from "@/services/files";
import LoadingSpinner from "@/components/LoadingSpinner";
import Text from "@/ui/Text";
import styles from "./ScreenshotUpload.module.scss";

type UploadProgress = { done: number; total: number };

// The types the upload endpoints accept.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif"];
const isImageType = (type: string) => IMAGE_TYPES.includes(type);

// Spread `getRootProps()` on the drop target and render `getInputProps()` and
// `ScreenshotUploadOverlay` inside it.
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

  const upload = async (files: File[]) => {
    if (!files.length) return;
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
        alert(e.message);
      } finally {
        setProgress((p) =>
          !p || p.done + 1 >= p.total ? null : { ...p, done: p.done + 1 },
        );
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    if (disabled) return;
    const files = Array.from(e.clipboardData.items || [])
      .filter((item) => item.kind === "file" && isImageType(item.type))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (!files.length) return;

    e.preventDefault();
    upload(files);
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: upload,
    accept: IMAGE_TYPES,
    onDropRejected: () =>
      alert("Only PNG, JPEG and GIF images can be uploaded"),
    noClick,
    noKeyboard: noClick,
    disabled,
  });

  return { getRootProps, getInputProps, isDragActive, open, onPaste, progress };
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
  progress,
}: {
  dragging: boolean;
  progress: UploadProgress | null;
}) {
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
