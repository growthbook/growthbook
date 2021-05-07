import clsx from "clsx";
import { ReactElement, useEffect, useState } from "react";
import useForm, { InputProps, AdditionalProps } from "../../hooks/useForm";
import LoadingOverlay from "../LoadingOverlay";
import LoadingSpinner from "../LoadingSpinner";

// eslint-disable-next-line
export default function InlineForm<T, P extends AdditionalProps = {}>({
  editing,
  setEdit,
  initialValue,
  className,
  onSave,
  children,
  additionalProps,
}: {
  editing: boolean;
  setEdit: (edit: boolean) => void;
  initialValue: T;
  className?: string;
  onSave: (value: T, markdownValue: string) => Promise<void>;
  additionalProps?: P;
  children: (props: {
    value: T;
    inputProps: InputProps<T, P>;
    manualUpdate: (updates: Partial<T>) => void;
    save: (markdownValue?: string) => Promise<void>;
    cancel: () => void;
    onMarkdownChange: (getter: () => string) => void;
  }) => ReactElement;
}): ReactElement {
  const [value, inputProps, manualUpdate] = useForm(
    initialValue,
    "",
    additionalProps
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>(null);
  const [getMarkdownValue, setSetMarkdownValue] = useState(() => () => "");

  const onMarkdownChange = (getter: () => string) =>
    setSetMarkdownValue(() => getter);

  const startEditing = () => setEdit(true);
  const cancel = () => setEdit(false);

  const save = async (markdownValue?: string) => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const md =
        typeof markdownValue === "undefined"
          ? getMarkdownValue()
          : markdownValue;
      await onSave(value, md);
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  useEffect(() => {
    manualUpdate(initialValue);
  }, [initialValue]);

  if (!editing) {
    return (
      <div onDoubleClick={startEditing} className={className}>
        {children({
          value,
          inputProps,
          manualUpdate,
          save,
          cancel,
          onMarkdownChange,
        })}
      </div>
    );
  }

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {saving && <LoadingOverlay />}
      {children({
        value,
        inputProps,
        manualUpdate,
        save,
        cancel,
        onMarkdownChange,
      })}
      <div
        className="bg-dark text-center py-3"
        style={{
          position: "sticky",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 330,
          boxShadow: "rgb(0 0 0 / 30%) 0px -1px 8px 1px",
        }}
      >
        <div>
          <button
            type="submit"
            className={clsx("btn mr-2", {
              "btn-primary": !saving,
              "btn-secondary": saving,
            })}
            disabled={saving}
          >
            {saving && <LoadingSpinner />} Save Changes
          </button>
          <button
            className="btn btn-link text-light"
            onClick={(e) => {
              e.preventDefault();
              cancel();
            }}
          >
            cancel
          </button>
        </div>
        {error && <div className="alert alert-danger mt-1">{error}</div>}
      </div>
    </form>
  );
}
