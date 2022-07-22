import { FC, useState } from "react";
import { GBEdit } from "../Icons";
import HeaderWithEdit from "../Layout/HeaderWithEdit";
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
  header?: string;
  appBoxWrapper?: boolean;
}> = ({
  value,
  save,
  canEdit = true,
  canCreate = true,
  label = "description",
  className = "",
  header = "",
  appBoxWrapper = false,
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
        {header && <h4>{header}</h4>}
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
      {header && (
        <HeaderWithEdit
          edit={
            value &&
            canEdit &&
            (() => {
              setVal(value || "");
              setEdit(true);
            })
          }
        >
          {header}
        </HeaderWithEdit>
      )}
      <div className={appBoxWrapper ? "appbox p-3" : ""}>
        <div className="row">
          <div className="col">
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
    </div>
  );
};
export default MarkdownInlineEdit;
