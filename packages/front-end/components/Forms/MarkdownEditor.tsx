import clsx from "clsx";
import { ReactElement, useEffect, useState } from "react";
import RichMarkdownEditor from "rich-markdown-editor";
import { useAuth } from "../../services/auth";
import { ago } from "../../services/dates";
import styles from "./markdown-editor.module.scss";

export default function MarkdownEditor({
  editing,
  defaultValue,
  onChange,
  save,
  cancel,
  placeholder = "No details yet.",
  editPlaceholder = "Add some details...",
}: {
  editing: boolean;
  defaultValue: string;
  onChange: (getter: () => string) => void;
  save?: (markdownValue?: string) => Promise<void>;
  cancel?: () => void;
  placeholder?: string | ReactElement;
  editPlaceholder?: string;
}): ReactElement {
  useEffect(() => {
    onChange(() => defaultValue);
  }, []);

  const { apiCall } = useAuth();

  const [toasts, setToasts] = useState<
    {
      text: string;
      type: "error" | "info";
      time: Date;
    }[]
  >([]);

  const isEmpty = !defaultValue || !defaultValue.match(/[^\s\\]+/);

  return (
    <div
      className={clsx("position-relative", {
        "px-4 py-2 border rounded": editing,
        "p-1": !editing,
      })}
      style={{
        zIndex: 120,
      }}
      onClick={(e) => {
        // Bug - some buttons in the editor UI cause the form to submit
        // https://github.com/outline/rich-markdown-editor/issues/159
        const target = e.target as HTMLElement;
        if (target.tagName !== "A" && target.tagName !== "INPUT") {
          e.preventDefault();
        }
      }}
    >
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            right: 0,
            padding: 15,
            zIndex: 125,
          }}
        >
          {toasts.map((toast, i) => (
            <div key={i} className="toast show">
              <div className="toast-header">
                <div
                  className={clsx("rounded mr-2", {
                    "bg-info": toast.type === "info",
                    "bg-danger": toast.type === "error",
                  })}
                  style={{ width: 20, height: 20 }}
                />
                <strong className="mr-3">
                  {toast.type === "error" ? "Error" : "Notice"}
                </strong>
                <small>{ago(toast.time)}</small>
                <button
                  type="button"
                  className="ml-2 mb-1 close"
                  onClick={(e) => {
                    e.preventDefault();
                    const clone = [...toasts];
                    clone.splice(i, 1);
                    setToasts(clone);
                  }}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              <div className="toast-body">{toast.text}</div>
            </div>
          ))}
        </div>
      )}
      <RichMarkdownEditor
        readOnly={!editing}
        readOnlyWriteCheckboxes={!editing}
        headingsOffset={1}
        className={clsx(styles.editor, {
          "d-none": !editing && isEmpty,
        })}
        defaultValue={defaultValue}
        value={defaultValue}
        onChange={(getter) => {
          onChange(getter);
          if (!editing) {
            save(getter());
          }
        }}
        onSave={() => save()}
        onCancel={cancel}
        onShowToast={(message, code) => {
          setToasts([
            ...toasts,
            {
              text: message,
              type: code,
              time: new Date(),
            },
          ]);
        }}
        placeholder={editPlaceholder}
        uploadImage={async (file) => {
          const ext = file.name.split(".").reverse()[0];

          const { uploadURL, fileURL } = await apiCall<{
            uploadURL: string;
            fileURL: string;
          }>(`/upload/${ext}`, {
            method: "POST",
          });

          await fetch(uploadURL, {
            method: "PUT",
            headers: {
              "Content-Type": file.type,
            },
            body: file,
          });

          return fileURL;
        }}
      />
      {!editing && isEmpty && (
        <p>
          <em>{placeholder}</em>
        </p>
      )}
    </div>
  );
}
