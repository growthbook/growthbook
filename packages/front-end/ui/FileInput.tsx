import { ChangeEvent, FC, useRef, useState } from "react";
import clsx from "clsx";
import Button from "@/ui/Button";
import styles from "./FileInput.module.scss";

interface FileInputProps {
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  accept?: string;
  required?: boolean;
  placeholder?: string;
  name?: string;
}

const FileInput: FC<FileInputProps> = ({
  onChange,
  accept,
  required = false,
  placeholder = "Choose file...",
  name,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const innerOnChange = (e: ChangeEvent<HTMLInputElement>) => {
    setFileName(e.target.files?.[0]?.name || null);
    onChange(e);
  };

  return (
    <div>
      <label
        htmlFor={name}
        onClick={handleClick}
        className={styles.control}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <Button
          color="gray"
          variant="outline"
          size="sm"
          tabIndex={-1}
          stopPropagation
          onClick={handleClick}
        >
          Browse...
        </Button>
        <span
          className={clsx(styles.name, fileName === null && styles.placeholder)}
        >
          {fileName || placeholder}
        </span>
      </label>
      <input
        type="file"
        ref={fileInputRef}
        onChange={innerOnChange}
        accept={accept}
        required={required}
        name={name}
        className={styles.native}
        tabIndex={-1}
      />
    </div>
  );
};

export default FileInput;
