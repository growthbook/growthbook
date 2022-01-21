import stringify from "json-stringify-pretty-compact";
import { getTrackingCallback, TrackingType } from "../../services/codegen";
import { getApiHost, isCloud } from "../../services/env";
import { useState, useEffect } from "react";
import useUser from "../../hooks/useUser";
import { useDefinitions } from "../../services/DefinitionsContext";
import { SDKAttributeSchema } from "back-end/types/organization";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import Code from "../Code";
import ControlledTabs from "../Tabs/ControlledTabs";
import Tab from "../Tabs/Tab";

type Language = "tsx" | "javascript";

function indentLines(code: string, indent: number = 2) {
  const spaces = " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

function getExampleAttributes(attributeSchema?: SDKAttributeSchema) {
  if (!attributeSchema) return {};

  // eslint-disable-next-line
  const exampleAttributes: any = {};
  (attributeSchema || []).forEach(({ property, datatype }) => {
    const parts = property.split(".");
    const last = parts.pop();
    let current = exampleAttributes;
    for (let i = 0; i < parts.length; i++) {
      current[parts[i]] = current[parts[i]] || {};
      current = current[parts[i]];
    }

    // eslint-disable-next-line
    let value: any = null;
    if (datatype === "boolean") {
      value = true;
    } else if (datatype === "number") {
      value = 123;
    } else if (datatype === "string") {
      value = "foo";
    } else if (datatype === "number[]") {
      value = [1, 2, 3];
    } else if (datatype === "string[]") {
      value = ["foo", "bar"];
    }

    current[last] = value;
  });

  return exampleAttributes;
}

function getFeaturesUrl(apiKey?: string) {
  if (!apiKey) {
    return `/path/to/features.json`;
  }

  if (isCloud()) {
    return `https://cdn.growthbook.io/api/features/${apiKey}`;
  }

  return getApiHost() + `/api/features/${apiKey}`;
}

export default function CodeSnippetModal({ close }: { close: () => void }) {
  const [language, setLanguage] = useState<Language>("javascript");
  const [state, setState] = useState<{
    tracking: TrackingType;
    gaDimension?: string;
  }>({
    tracking: "custom",
    gaDimension: "1",
  });

  const { apiCall } = useAuth();

  const { settings, update } = useUser();

  const { datasources } = useDefinitions();
  const exampleAttributes = getExampleAttributes(
    settings?.attributeSchema || []
  );

  // Create API key if one doesn't exist yet
  const [apiKey, setApiKey] = useState("");
  useEffect(() => {
    apiCall<{ key: string }>(`/keys?preferExisting=true`, {
      method: "POST",
      body: JSON.stringify({
        description: "Features SDK",
      }),
    })
      .then(({ key }) => {
        setApiKey(key);
      })
      .catch((e) => {
        console.error(e);
      });
  }, []);

  useEffect(() => {
    const ds = datasources?.[0];
    if (!ds) return;
    if (ds.type === "mixpanel") {
      setState({
        ...state,
        tracking: "mixpanel",
      });
    } else if (ds.type === "google_analytics") {
      setState({
        ...state,
        tracking: "ga",
        gaDimension: ds.params.customDimension,
      });
    } else {
      setState({
        ...state,
        tracking: "custom",
      });
    }
  }, [datasources?.[0]?.type]);

  return (
    <Modal
      close={close}
      open={true}
      size="lg"
      header="Implementation Instructions"
      submit={async () => {
        if (settings?.sdkInstructionsViewed) return;
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: {
              sdkInstructionsViewed: true,
            },
          }),
        });
        await update();
      }}
      cta={"Finish"}
    >
      {apiKey && (
        <>
          <p>
            We generated an API endpoint for you that will contain all of your
            feature definitions:
          </p>
          <input
            readOnly
            value={getFeaturesUrl(apiKey)}
            className="form-control mb-3"
            onFocus={(e) => {
              (e.target as HTMLInputElement).select();
            }}
          />
        </>
      )}
      <p>
        Below is some starter code to integrate GrowthBook into your app. More
        languages coming soon!
      </p>
      <ControlledTabs
        active={language}
        setActive={(language) => setLanguage(language as Language)}
      >
        <Tab display="Javascript" id="javascript">
          <p>
            Read the{" "}
            <a
              href="https://docs.growthbook.io/lib/js"
              target="_blank"
              rel="noopener noreferrer"
            >
              full Javascript docs
            </a>{" "}
            for more details.
          </p>
          <Code
            language="javascript"
            code={`
import { GrowthBook } from "@growthbook/growthbook";

const FEATURES_ENDPOINT = "${getFeaturesUrl(apiKey)}";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
  trackingCallback: (experiment, result) => {
    ${indentLines(
      getTrackingCallback(
        state.tracking,
        state.gaDimension + "",
        "experiment.key",
        "result.variationId"
      ),
      4
    )}
  }
});

// Load feature definitions from API
fetch(FEATURES_ENDPOINT)
  .then((res) => res.json())
  .then((json) => {
    growthbook.setFeatures(json${apiKey ? ".features" : ""});
  });

// TODO: replace with real targeting attributes
growthbook.setAttributes(${indentLines(stringify(exampleAttributes), 2)});
            `.trim()}
          />
        </Tab>
        <Tab display="React" id="tsx">
          <p>
            Read the{" "}
            <a
              href="https://docs.growthbook.io/lib/react"
              target="_blank"
              rel="noopener noreferrer"
            >
              full React docs
            </a>{" "}
            for more details.
          </p>
          <Code
            language="tsx"
            code={`
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { useEffect } from "react";

const FEATURES_ENDPOINT = "${getFeaturesUrl(apiKey)}";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
  trackingCallback: (experiment, result) => {
    ${indentLines(
      getTrackingCallback(
        state.tracking,
        state.gaDimension + "",
        "experiment.key",
        "result.variationId"
      ),
      4
    )}
  }
});

export default function MyApp() {
  useEffect(() => {
    // Load feature definitions from API
    fetch(FEATURES_ENDPOINT)
      .then((res) => res.json())
      .then((json) => {
        growthbook.setFeatures(json${apiKey ? ".features" : ""});
      });
    
    // TODO: replace with real targeting attributes
    growthbook.setAttributes(${indentLines(stringify(exampleAttributes), 4)})
  }, [])

  return (
    <GrowthBookProvider growthbook={growthbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}
            `.trim()}
          />
        </Tab>
      </ControlledTabs>
    </Modal>
  );
}
