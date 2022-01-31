import { useState } from "react";
import { ApiKeyInterface } from "back-end/types/apikey";
import useApi from "../../hooks/useApi";
import track from "../../services/track";
import CodeSnippetModal from "./CodeSnippetModal";

export default function ApiKeyUpgrade() {
  const { data, error, mutate } = useApi<{ keys: ApiKeyInterface[] }>(`/keys`);
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <CodeSnippetModal
        close={() => {
          setOpen(false);
          mutate();
        }}
      />
    );
  }

  if (!data?.keys?.length || error) return null;

  const hasDevKey = data.keys.filter((k) => k.environment === "dev").length > 0;
  const hasProdKey =
    data.keys.filter((k) => k.environment === "production").length > 0;

  if (hasDevKey && hasProdKey) return null;

  return (
    <>
      <div className="alert alert-info text-align-center">
        <div className="d-flex align-items-center justify-content-center">
          <div className="mr-3">
            We recently added support for multiple API keys - one for{" "}
            <strong>dev</strong> and one for <strong>production</strong>. This
            requires updating your SDK integration.
          </div>
          <div>
            <button
              className="btn btn-info btn-sm"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setOpen(true);
                track("Upgrade API Keys");
              }}
            >
              View Instructions
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
