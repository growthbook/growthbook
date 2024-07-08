import { useState } from "react";
import { GBEdit } from "@/components/Icons";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import LoadingOverlay from "@/components/LoadingOverlay";
import Markdown from "./Markdown";
import MarkdownInput from "./MarkdownInput";

type Props = {
  value: string;
  save: (text: string) => Promise<void>;
  canEdit?: boolean;
  canCreate?: boolean;
  label?: string;
  className?: string;
  containerClassName?: string;
  header?: string | JSX.Element;
  headerClassName?: string;
  editClassName?: string;
};

export default function MarkdownInlineEdit({
  value,
  save,
  canEdit = true,
  canCreate = true,
  label = "description",
  className = "",
  containerClassName = "",
  header = "",
  headerClassName = "h3",
  editClassName = "a",
}: Props) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  const [error, setError] = useState<string | null>(null);
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
        {header && <div className={headerClassName}>{header}</div>}
        {loading && <LoadingOverlay />}
        <MarkdownInput
          value={val}
          setValue={setVal}
          cta={"Save"}
          error={error ?? undefined}
          autofocus={true}
          onCancel={() => setEdit(false)}
        />
      </form>
    );
  }

  return (
    <div className={className}>
      {header && (
        <HeaderWithEdit
          edit={
            value && canEdit
              ? () => {
                  setVal(value || "");
                  setEdit(true);
                }
              : undefined
          }
          className={headerClassName}
          containerClassName={containerClassName}
          editClassName={editClassName}
        >
          {header}
        </HeaderWithEdit>
      )}
      <div className="row">
        <div className="col-auto">
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
        </div>
        {value && canEdit && !header && (
          <div className="col-auto">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setVal(value || "");
                setEdit(true);
              }}
            >
              <GBEdit />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
