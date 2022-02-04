import stringify from "json-stringify-pretty-compact";
import { getApiHost, isCloud } from "../../services/env";
import { useState, useEffect } from "react";
import useUser from "../../hooks/useUser";
import { SDKAttributeSchema } from "back-end/types/organization";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import { FeatureInterface } from "back-end/types/feature";
import ExampleCode, { LanguageData, useExampleLanguage } from "./ExampleCode";
import track from "../../services/track";

export function useApiKeys(): [string, string] {
  const { apiCall } = useAuth();

  // Create API key if one doesn't exist yet
  const [devApiKey, setDevApiKey] = useState("");
  const [prodApiKey, setProdApiKey] = useState("");
  useEffect(() => {
    (async () => {
      const devKey = await apiCall<{ key: string }>(
        `/keys?preferExisting=true`,
        {
          method: "POST",
          body: JSON.stringify({
            description: "Dev Features SDK",
            environment: "dev",
          }),
        }
      );
      setDevApiKey(devKey.key);

      const prodKey = await apiCall<{ key: string }>(
        `/keys?preferExisting=true`,
        {
          method: "POST",
          body: JSON.stringify({
            description: "Production Features SDK",
            environment: "production",
          }),
        }
      );
      setProdApiKey(prodKey.key);
    })();
  }, []);

  return [devApiKey, prodApiKey];
}

export function useFeatureExampleCode(
  feature?: FeatureInterface,
  devApiKey: string = "",
  prodApiKey: string = ""
): LanguageData[] {
  const { settings } = useUser();

  const exampleAttributes = getExampleAttributes(
    settings?.attributeSchema || []
  );

  const featureKey = feature?.id ?? "my-feature";
  const isBooleanFeature = (feature?.valueType ?? "boolean") === "boolean";

  return [
    {
      language: "javascript",
      files: [
        {
          name: "Terminal",
          language: "sh",
          code: "npm i --save @growthbook/growthbook",
        },
        {
          name: "index.js",
          language: "javascript",
          code: `
import growthbook from './setup'

// Use a feature!
const feature = growthbook.feature("${featureKey}");
${
  isBooleanFeature
    ? `if (feature.on) {
  console.log("New Version")
} else {
  console.log("Old Version")
}`
    : `console.log(feature.value);`
}
          `,
        },
        {
          name: "setup.js",
          language: "javascript",
          code: `
import { GrowthBook } from "@growthbook/growthbook";

const API_KEY = "${devApiKey}";
// const API_KEY = "${prodApiKey}";
${
  isCloud()
    ? ""
    : `\n// In production, we recommend putting a CDN in front of the API endpoint`
}
const API_HOST = "${getApiBaseUrl()}";

const growthbook = new GrowthBook({
  trackingCallback: (experiment, result) => {
    // TODO: track in your analytics system
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    })
  }
});

// Load feature definitions from API
fetch(\`\${API_HOST}/api/features/\${API_KEY}\`)
  .then((res) => res.json())
  .then((json) => {
    growthbook.setFeatures(json.features);
  });

// TODO: replace with real targeting attributes
growthbook.setAttributes(${JSON.stringify(exampleAttributes, null, 2)});

export default growthbook;
`,
        },
      ],
    },
    {
      language: "react",
      files: [
        {
          name: "Terminal",
          language: "sh",
          code: `npm i --save @growthbook/growthbook-react`,
        },
        {
          name: "MyComponent.jsx",
          language: "tsx",
          code: `
import { useFeature } from "@growthbook/growthbook-react";

export function MyComponent() {
  const feature = useFeature("${featureKey}")
  ${
    isBooleanFeature
      ? `if (feature.on) {
    return <div>New Version</div>
  } else {
    return <div>Old Version</div>
  }`
      : `return <div>{feature.value}</div>`
  }
}
          `,
        },
        {
          name: "app.jsx",
          language: "tsx",
          code: `
import { GrowthBook, GrowthBookProvider } from "@growthbook/growthbook-react";
import { useEffect } from "react";
import MyComponent from "./MyComponent";

const API_KEY = "${devApiKey}";
// const API_KEY = "${prodApiKey}";
${
  isCloud()
    ? ""
    : `\n// In production, we recommend putting a CDN in front of the API endpoint`
}
const API_HOST = "${getApiBaseUrl()}";

// Create a GrowthBook instance
const growthbook = new GrowthBook({
  trackingCallback: (experiment, result) => {
    // TODO: track in your analytics system
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    })
  }
});

export default function MyApp() {
  useEffect(() => {
    // Load feature definitions from API
    fetch(\`\${API_HOST}/api/features/\${API_KEY}\`)
      .then((res) => res.json())
      .then((json) => {
        growthbook.setFeatures(json${devApiKey ? ".features" : ""});
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
          `,
        },
      ],
    },
    {
      language: "go",
      files: [
        {
          name: "Terminal",
          language: "sh",
          code: `go get github.com/growthbook/growthbook-golang`,
        },
        {
          name: "main.go",
          language: "go",
          code: `
package main

import (
	"encoding/json"
	"fmt"
	growthbook "github.com/growthbook/growthbook-golang"
	"io/ioutil"
	"log"
	"net/http"
)

const ApiKey = "${devApiKey}"
// const ApiKey = "${prodApiKey}"
${
  isCloud()
    ? ""
    : `\n// In production, we recommend putting a CDN in front of the API endpoint`
}
const ApiHost = "${getApiBaseUrl()}"

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
  feature := gb.Feature("${featureKey}")
  ${
    isBooleanFeature
      ? `if feature.On {
    fmt.Print("On!")
  } else {
    fmt.Print("Off!")
  }`
      : `fmt.Print(feature.Value);`
  }
}

// Features API response
type GrowthBookApiResp struct {
	Features json.RawMessage
	Status   int
}

func GetFeatureMap() []byte {
	// Fetch features JSON from api
	// In production, we recommend adding a db or cache layer
	resp, err := http.Get(ApiHost + "/api/features/" + ApiKey)
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
          `,
        },
      ],
    },
    {
      language: "kotlin",
      files: [
        {
          name: "build.gradle",
          language: "javascript",
          code: `
repositories {
    mavenCentral()
}

dependencies {
    implementation 'io.growthbook.sdk:GrowthBook:1.+'
}`,
        },
        {
          name: "app.kt",
          language: "kotlin",
          code: `
import com.sdk.growthbook.GBSDKBuilder

val apiKey = "${devApiKey}"
// val apiKey = "${prodApiKey}"
${!isCloud() ? "\n// We recommend using a CDN in production" : ""}
val apiHost = "${getApiBaseUrl()}/"

// TODO: Real user attributes
val attrs = HashMap<String, Any>()
${Object.keys(exampleAttributes)
  .map((k) => {
    return `attrs.put("${k}", ${JSON.stringify(exampleAttributes[k])})`;
  })
  .join("\n")}

val gb = GBSDKBuilder(
  apiKey = apiKey,
  hostURL = apiHost,
  attributes = attrs,
  trackingCallback = { gbExperiment, gbExperimentResult ->
    // TODO: track in your analytics system
  }
).initialize()

val feature = gb.feature("${featureKey}")
${
  isBooleanFeature
    ? `if feature.on {
  println("On!")
} else {
  println("Off!")
}`
    : `println(feature.value);`
}
          `,
        },
      ],
    },
  ];
}

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

function getApiBaseUrl(): string {
  if (isCloud()) {
    return `https://cdn.growthbook.io`;
  }
  return getApiHost();
}

export default function CodeSnippetModal({
  close,
  feature,
  setLanguage,
}: {
  close: () => void;
  feature?: FeatureInterface;
  setLanguage?: (language: string) => void;
}) {
  const language = useExampleLanguage();
  const [devApiKey, prodApiKey] = useApiKeys();

  const { settings, update } = useUser();
  const { apiCall } = useAuth();

  const exampleCode = useFeatureExampleCode(feature, devApiKey, prodApiKey);

  useEffect(() => {
    if (setLanguage) {
      setLanguage(language[0]);
    }
  }, []);

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
        track("Finished Implementation Instructions", {
          sdk: language[0],
        });
        await update();
      }}
      cta={"Finish"}
    >
      {devApiKey && (
        <div className="mb-3">
          <p>
            We generated API keys for you that will contain all of your feature
            definitions:
          </p>
          <div className="row mb-2">
            <div className="col-auto" style={{ width: 120 }}>
              <div className="mt-2">
                <strong>API Host</strong>
              </div>
            </div>
            <div className="col">
              <input
                readOnly
                value={getApiBaseUrl()}
                onFocus={(e) => e.target.select()}
                className="form-control"
              />
              {!isCloud() && (
                <small>
                  In production, we recommend using a CDN or adding a
                  database/cache layer.
                </small>
              )}
            </div>
          </div>
          <div className="row mb-2 align-items-center">
            <div className="col-auto" style={{ width: 120 }}>
              <strong>Dev Key</strong>
            </div>
            <div className="col">
              <input
                readOnly
                value={devApiKey}
                onFocus={(e) => e.target.select()}
                className="form-control"
              />
            </div>
          </div>
          <div className="row align-items-center">
            <div className="col-auto" style={{ width: 120 }}>
              <strong>Production Key</strong>
            </div>
            <div className="col">
              <input
                readOnly
                value={prodApiKey}
                onFocus={(e) => e.target.select()}
                className="form-control"
              />
            </div>
          </div>
        </div>
      )}
      <p>
        Below is some starter code to integrate GrowthBook into your app. More
        languages coming soon!
      </p>
      <ExampleCode
        language={[
          language[0],
          (l) => {
            language[1](l);
            if (setLanguage) setLanguage(l);
          },
        ]}
        code={exampleCode}
      />
    </Modal>
  );
}
