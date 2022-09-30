import { ApiKeyInterface } from "back-end/types/apikey";
import { useEffect, useState } from "react";
import { useAuth } from "../../services/auth";
import LoadingOverlay from "../LoadingOverlay";
import VisualEditorInstructions from "../Settings/VisualEditorInstructions";
import usePermissions from "../../hooks/usePermissions";

export default function VisualEditorScriptMissing({
  onSuccess,
  url,
  changeUrl,
}: {
  onSuccess: () => void;
  changeUrl: () => void;
  url?: string;
}) {
  const { apiCall } = useAuth();
  const permissions = usePermissions();
  const [apiKeys, setApiKeys] = useState<ApiKeyInterface[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  async function refreshApiKeys() {
    const res = await apiCall<{ keys: ApiKeyInterface[] }>(`/keys`, {
      method: "GET",
    });
    setApiKeys(res.keys);
  }

  useEffect(() => {
    if (!permissions.organizationSettings) {
      setReady(true);
      return;
    }
    refreshApiKeys()
      .then(() => {
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
      });
  }, [permissions.organizationSettings]);

  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!permissions.organizationSettings) {
    return (
      <div className="alert alert-info">
        We were able to load the site, but couldn&apos;t communicate with it.
        Please ask your organization administrator to configure the Visual
        Editor on your website.
      </div>
    );
  }
  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  return (
    <div>
      <VisualEditorInstructions
        apiKeys={apiKeys}
        mutate={refreshApiKeys}
        url={url}
        changeUrl={changeUrl}
      />
      {apiKeys.length > 0 && (
        <div className="alert alert-info mt-3">
          After adding the above scripts:{" "}
          <a
            href="#"
            className="btn btn-primary btn-sm mr-5"
            onClick={(e) => {
              e.preventDefault();
              onSuccess();
            }}
          >
            Refresh
          </a>
        </div>
      )}
    </div>
  );
}
