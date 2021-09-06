import clsx from "clsx";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";

const EditableH1: FC<{
  editing: boolean;
  className?: string;
  autoFocus?: boolean;
  cancel?: () => void;
  save?: () => Promise<void>;
  name: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
}> = ({ editing, className, save, cancel, autoFocus, name, form }) => {
  const value = form.watch(name);

  if (!editing) {
    return <h1 className={className}>{value}</h1>;
  }
  return (
    <input
      type="text"
      className={clsx(className, "form-control form-control-lg")}
      {...form.register(name)}
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
