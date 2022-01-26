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

type Language = "tsx" | "javascript" | "go";

function indentLines(code: string, indent: number | string = 2) {
  const spaces = typeof indent === "string" ? indent : " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

function getExampleAttributes(attributeSchema?: SDKAttributeSchema) {
  if (!attributeSchema) return {};

  // eslint-disable-next-line
  const exampleAttributes: any = {};
  (attributeSchema || []).forEach(({ property, datatype, enum: enumList }) => {
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
    } else if (datatype === "enum") {
      value = enumList.split(",").map((v) => v.trim())[0] ?? null;
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
          <Code language="sh" code="npm i --save @growthbook/growthbook" />
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

// Use a feature!
if (growthbook.feature("my-feature").on) {
  // ...
}
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
            language="sh"
            code="npm i --save @growthbook/growthbook-react"
          />
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

// Use a feature!
function MyComponent() {
  const feature = useFeature("my-feature")
  return feature.on ? "New version" : "Old Version"
}
            `.trim()}
          />
        </Tab>
        <Tab display="Go" id="go">
          <p>
            Read the{" "}
            <a
              href="https://docs.growthbook.io/lib/go"
              target="_blank"
              rel="noopener noreferrer"
            >
              full Golang SDK docs
            </a>{" "}
            for more details.
          </p>
          <Code
            language="sh"
            code="go get github.com/growthbook/growthbook-golang"
          />
          <Code
            language="go"
            code={`
package main

import (
	"encoding/json"
	"fmt"
	growthbook "github.com/growthbook/growthbook-golang"
	"io/ioutil"
	"log"
	"net/http"
)

// Features API response
type GrowthBookApiResp struct {
	Features json.RawMessage
	Status   int
}

func GetFeatureMap() []byte {
	// Fetch features JSON from api
	// In production, we recommend using a db or cache layer instead
	resp, err := http.Get("${getFeaturesUrl(apiKey)}")
	if err != nil {
		log.Println(err)
	}
	defer resp.Body.Close()
	body, err := ioutil.ReadAll(resp.Body)
	// Just return the features map from the API response
	apiResp := &GrowthBookApiResp{}
	_ = json.Unmarshal(body, apiResp)
	return apiResp.Features
}

func main() {
	featureMap := GetFeatureMap()
	features := growthbook.ParseFeatureMap(featureMap)

	context := growthbook.NewContext().
		WithFeatures(features).
		// TODO: Real user attributes
		WithAttributes(growthbook.Attributes${indentLines(
      JSON.stringify(exampleAttributes, null, "\t"),
      "\t\t"
    )
      .replace(/null/g, "nil")
      .replace(/\n(\t+)\}/, ",\n$1}")}).
		// TODO: Track in your analytics system
		WithTrackingCallback(func(experiment *growthbook.Experiment, result *growthbook.ExperimentResult) {
			log.Println(fmt.Sprintf("Experiment: %s, Variation: %d", experiment.Key, result.VariationID))
		})
	gb := growthbook.New(context)

	// Use a feature!
	if gb.Feature("my-feature").On {
		// ...
	}
}
            `.trim()}
          />
        </Tab>
      </ControlledTabs>
    </Modal>
  );
}
