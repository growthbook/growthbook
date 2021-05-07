import React, {
  DetailedHTMLProps,
  HTMLAttributes,
  ReactElement,
  useState,
} from "react";
import { useDropzone } from "react-dropzone";
import { Screenshot } from "back-end/types/experiment";
import { useAuth } from "../../services/auth";
import styles from "./ScreenshotUpload.module.scss";
import clsx from "clsx";
import LoadingOverlay from "../LoadingOverlay";

type props = {
  experiment: string;
  variation: number;
  onSuccess: (variation: number, screenshot: Screenshot) => void;
};

const ScreenshotUpload = ({
  experiment,
  variation,
  onSuccess,
}: props): ReactElement => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(0);

  const onDrop = (files: File[]) => {
    setLoading(loading + files.length);

    files.forEach(async (file) => {
      const ext = file.name.split(".").reverse()[0];

      const { uploadURL, fileURL } = await apiCall<{
        uploadURL: string;
        fileURL: string;
      }>(`/experiment/${experiment}/upload/${ext}`, {
        method: "POST",
      });

      await fetch(uploadURL, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      await apiCall(
        `/experiment/${experiment}/variation/${variation}/screenshot`,
        {
          method: "PUT",
          body: JSON.stringify({
            url: fileURL,
            // TODO: allow customizing description
            description: "",
          }),
        }
      );

      setLoading(loading - 1);

      onSuccess(variation, {
        path: fileURL,
        description: "",
      });
    });
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
        className={clsx(styles.droparea, { [styles.dragging]: isDragActive })}
      >
        {loading > 0 ? <LoadingOverlay /> : ""}
        <input {...getInputProps()} />
        <div className={styles.message}>Drop Image Here...</div>
        <button className="btn btn-outline-primary">Upload Screenshot</button>
      </div>
    </>
  );
};

export default ScreenshotUpload;
