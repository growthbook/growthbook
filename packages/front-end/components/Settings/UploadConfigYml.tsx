import clsx from "clsx";
import React, { DetailedHTMLProps, HTMLAttributes } from "react";
import { useDropzone } from "react-dropzone";
import styles from "./UploadConfigYml.module.scss";

export default function UploadConfigYml({
  setContent,
}: {
  setContent(content: string): void;
}) {
  const onDrop = (files: File[]) => {
    const file = files[0];

    const reader = new FileReader();
    reader.onload = function () {
      setContent(reader.result as string);
    };
    reader.readAsText(file);
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
  });

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
        <input {...getInputProps()} />
        <div className={styles.message}>Drop config.yml Here...</div>
        <button className="btn btn-outline-primary btn-sm" type="button">
          Upload config.yml
        </button>
      </div>
    </>
  );
}
