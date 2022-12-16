import { ApiKeyInterface } from "back-end/types/apikey";
import { useEffect, useState } from "react";
import { FaKey, FaPencilAlt } from "react-icons/fa";
import { getApiHost, isCloud } from "@/services/env";
import Code from "../SyntaxHighlighting/Code";
import { DocLink } from "../DocLink";
import SelectField from "../Forms/SelectField";
import ApiKeysModal from "./ApiKeysModal";

export default function VisualEditorInstructions({
  apiKeys,
  mutate,
  url,
  changeUrl,
}: {
  apiKeys: ApiKeyInterface[];
  mutate: () => void;
  url?: string;
  changeUrl?: () => void;
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

  const visualScriptHost = isCloud()
    ? "https://cdn.growthbook.io"
    : getApiHost();

  return (
    <div>
      {apiKeys.length > 1 && (
        <div className="input-group">
          <div className="input-group-prepend">
            <div className="input-group-text">API Key</div>
            <SelectField
              value={key}
              onChange={(v) => setKey(v)}
              options={apiKeys.map((k) => ({
                value: k.key,
                label: k.description || k.key,
              }))}
            />
          </div>
        </div>
      )}
      {url ? (
        <p>
          Modify and add the below code to <code>{url}</code>{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              changeUrl();
            }}
          >
            <FaPencilAlt />
          </a>
        </p>
      ) : (
        <p>
          Modify and add the below code to the HEAD of the website you want to
          test.
        </p>
      )}
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
        <DocLink docSection="visual_editor">
          https://docs.growthbook.io/app/visual
        </DocLink>
      </div>
    </div>
  );
}
