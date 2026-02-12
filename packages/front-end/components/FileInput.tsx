import { FC, useRef, ChangeEvent, useState, CSSProperties } from "react";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

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

  const placeHolderStyle: CSSProperties = {
    color: "var(--gray-10)",
  };

  return (
    <div>
      <label
        htmlFor={name}
        onClick={handleClick}
        className="form-control cursor-pointer"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleClick();
          }
        }}
      >
        <Button
          color="gray"
          variant="outline"
          size="xs"
          mt="-2px"
          mr="1"
          onClick={handleClick}
          tabIndex={-1}
        >
          Browse...
        </Button>
        <Text
          weight="regular"
          style={fileName === null ? placeHolderStyle : undefined}
        >
          {fileName || placeholder}
        </Text>
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
