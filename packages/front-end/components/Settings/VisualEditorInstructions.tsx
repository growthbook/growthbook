import { ApiKeyInterface } from "back-end/types/apikey";
import { useEffect } from "react";
import { useState } from "react";
import { FaKey } from "react-icons/fa";
import Code from "../Code";
import ApiKeysModal from "./ApiKeysModal";

export default function VisualEditorInstructions({
  apiKeys,
  mutate,
}: {
  apiKeys: ApiKeyInterface[];
  mutate: () => void;
}) {
  const [key, setKey] = useState("");
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);

  useEffect(() => {
    if (!key && apiKeys.length > 0) {
      setKey(apiKeys[0].key);
    }
  }, [apiKeys]);

  if (!apiKeys.length) {
    return (
      <>
        {apiKeyModalOpen && (
          <ApiKeysModal
            close={() => setApiKeyModalOpen(false)}
            onCreate={mutate}
            defaultDescription="Visual Editor"
          />
        )}
        <div className="alert alert-warning">
          You need to create an API key first before you can use the Visual
          Editor
        </div>
        <button
          className="btn btn-success"
          onClick={(e) => {
            e.preventDefault();
            setApiKeyModalOpen(true);
          }}
        >
          <FaKey /> Create API Key
        </button>
      </>
    );
  }

  const visualScriptHost = process.env.NEXT_PUBLIC_IS_CLOUD
    ? "https://cdn.growthbook.io"
    : process.env.NEXT_PUBLIC_API_HOST;

  return (
    <div>
      {apiKeys.length > 1 && (
        <div className="input-group">
          <div className="input-group-prepend">
            <div className="input-group-text">API Key</div>
            <select
              className="form-control"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            >
              {apiKeys.map((k) => {
                return (
                  <option key={k.key} value={k.key}>
                    {k.description || k.key}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      )}
      <p>Add the below code to the HEAD of the website you want to test.</p>
      <Code
        language="html"
        code={`<script>
window.GROWTHBOOK_CONFIG = {
  // Optional logged-in user id
  userId: "123",
  // Impression tracking callback (e.g. Segment, Mixpanel, GA)
  track: function(experimentId, variationId) {
    analytics.track("Experiment Viewed", {
      experimentId,
      variationId
    })
  }
}
</script>
<script async src="${visualScriptHost}/js/${key}.js"></script>`}
      />
      <div>
        Check out the full docs at{" "}
        <a
          href="https://docs.growthbook.io/app/visual"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://docs.growthbook.io/app/visual
        </a>
      </div>
    </div>
  );
}
