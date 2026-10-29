import { FC, useRef, ChangeEvent, useState } from "react";
import Button from "@/ui/Button";

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
        className="form-control gb-file-input"
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
          className={
            fileName === null
              ? "gb-file-input__name gb-file-input__name--placeholder"
              : "gb-file-input__name"
          }
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
        // NB: Using display: none hides the native required message from the browser
        style={{ display: "block", height: 0, width: 0, opacity: 0 }}
        tabIndex={-1}
      />
    </div>
  );
};

export default FileInput;
