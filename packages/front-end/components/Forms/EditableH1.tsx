import clsx from "clsx";
import { ChangeEvent, CSSProperties, FC } from "react";
import Field from "./Field";

const EditableH1: FC<{
  editing: boolean;
  value: string;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  label?: string;
  cancel?: () => void;
  save?: () => Promise<void>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}> = ({
  editing,
  value,
  className,
  style,
  save,
  cancel,
  autoFocus,
  onChange,
  label,
}) => {
  if (!editing) {
    return <h1 className={className}>{value}</h1>;
  }
  return (
    <Field
      label={label}
      className={clsx(className, "form-control-lg")}
      style={style}
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
