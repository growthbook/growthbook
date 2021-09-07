import { FC, useState } from "react";
import LoadingOverlay from "../LoadingOverlay";
import Markdown from "./Markdown";
import MarkdownInput from "./MarkdownInput";

const MarkdownInlineEdit: FC<{
  save: (text: string) => Promise<void>;
  canEdit?: boolean;
  canCreate?: boolean;
  value: string;
  label?: string;
  className?: string;
}> = ({
  value,
  save,
  canEdit = true,
  canCreate = true,
  label = "description",
  className = "",
}) => {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  const [error, setError] = useState<string>(null);
  const [loading, setLoading] = useState(false);

  if (edit) {
    return (
      <form
        className={"position-relative" + " " + className}
        onSubmit={async (e) => {
          e.preventDefault();
          if (loading) return;
          setError(null);
          setLoading(true);
          try {
            await save(val);
            setEdit(false);
          } catch (e) {
            setError(e.message);
          }
          setLoading(false);
        }}
      >
        {loading && <LoadingOverlay />}
        <MarkdownInput
          value={val}
          setValue={setVal}
          cta={"Save"}
          error={error}
          autofocus={true}
          onCancel={() => setEdit(false)}
        />
      </form>
    );
  }

  return (
    <div className={className}>
      {value ? (
        <Markdown className="card-text">{value}</Markdown>
      ) : (
        <div className="card-text">
          {canCreate ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setVal(value || "");
                setEdit(true);
              }}
            >
              <em>Add {label}</em>
            </a>
          ) : (
            <em>No {label}</em>
          )}
        </div>
      )}

      {value && canEdit && (
        <div className="text-right">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setVal(value || "");
              setEdit(true);
            }}
          >
            edit {label}
          </a>
        </div>
      )}
    </div>
  );
};
export default MarkdownInlineEdit;
