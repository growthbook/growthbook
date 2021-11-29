import clsx from "clsx";
import { ReactElement, useState } from "react";
import LoadingOverlay from "../LoadingOverlay";
import LoadingSpinner from "../LoadingSpinner";

// eslint-disable-next-line
export default function InlineForm({
  editing,
  setEdit,
  className,
  onSave,
  onStartEdit,
  children,
}: {
  editing: boolean;
  setEdit: (edit: boolean) => void;
  className?: string;
  onSave: () => Promise<void>;
  onStartEdit: () => void;
  children: (props: {
    save: () => Promise<void>;
    cancel: () => void;
  }) => ReactElement;
}): ReactElement {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>(null);

  const startEditing = () => {
    onStartEdit();
    setEdit(true);
  };
  const cancel = () => setEdit(false);

  const save = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSave();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  if (!editing) {
    return (
      <div onDoubleClick={startEditing} className={className}>
        {children({
          save,
          cancel,
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
        save,
        cancel,
      })}
      <div
        className="text-center py-3"
        style={{
          position: "sticky",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 330,
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
            className="btn btn-link "
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
