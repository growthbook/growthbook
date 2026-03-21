import React, {
  DetailedHTMLProps,
  HTMLAttributes,
  ClipboardEvent,
  ReactElement,
  ReactNode,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import { Screenshot } from "shared/types/experiment";
import clsx from "clsx";
import { BiImageAdd } from "react-icons/bi";
import { useAuth } from "@/services/auth";
import { uploadFile } from "@/services/files";
import LoadingOverlay from "@/components/LoadingOverlay";
import styles from "./ScreenshotUpload.module.scss";

type props = {
  experiment: string;
  variation: number;
  onSuccess: (variation: number, screenshot: Screenshot) => void;
  children?: ReactNode;
};

const ScreenshotUpload = ({
  experiment,
  variation,
  onSuccess,
  children,
}: props): ReactElement => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(0);

  if (!children && children !== 0)
    children = (
      <span className={styles.textlink}>
        <BiImageAdd className="mr-1" style={{ fontSize: 20 }} />
        Add Screenshot
      </span>
    );

  const onDrop = async (files: File[]) => {
    await uploadScreenshots(files);
  };

  const onPaste = async (e: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (!files.length) return;

    e.preventDefault();
    await uploadScreenshots(files);
  };

  const uploadScreenshots = async (files: File[]) => {
    if (!files.length) return;

    setLoading((previous) => previous + files.length);

    for (const file of files) {
      try {
        const { fileURL } = await uploadFile(apiCall, file);

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

        setLoading((previous) => previous - 1);

        onSuccess(variation, {
          path: fileURL,
          description: "",
        });
      } catch (e) {
        alert(e.message);
      } finally {
        setLoading((previous) => previous - 1);
      }
    }
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  // getRootProps assumes generic HTMLElement, but we're using HTMLDivElement
  const rootProps: unknown = getRootProps();
  const typedRootProps = rootProps as DetailedHTMLProps<
    HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;

  return (
    <>
      <div
        {...typedRootProps}
        onPaste={onPaste}
        tabIndex={0}
        className={clsx(styles.droparea, "my-1", {
          [styles.dragging]: isDragActive,
        })}
      >
        {loading > 0 ? <LoadingOverlay /> : ""}
        <input {...getInputProps()} />
        <div className={styles.message}>Drop Image Here...</div>
        {children}
      </div>
    </>
  );
};

export default ScreenshotUpload;
