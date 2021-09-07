import clsx from "clsx";
import { ChangeEvent, FC } from "react";

const EditableH1: FC<{
  editing: boolean;
  value: string;
  className?: string;
  autoFocus?: boolean;
  cancel?: () => void;
  save?: () => Promise<void>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}> = ({ editing, value, className, save, cancel, autoFocus, onChange }) => {
  if (!editing) {
    return <h1 className={className}>{value}</h1>;
  }
  return (
    <input
      type="text"
      className={clsx(className, "form-control form-control-lg")}
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.ctrlKey) {
          e.preventDefault();
          cancel && cancel();
        } else if (e.key === "s" && e.ctrlKey) {
          e.preventDefault();
          save && save();
        }
      }}
    />
  );
};
export default EditableH1;
