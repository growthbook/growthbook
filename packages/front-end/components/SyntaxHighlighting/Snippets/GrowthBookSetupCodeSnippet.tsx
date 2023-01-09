import { SDKLanguage } from "back-end/types/sdk-connection";
import stringify from "json-stringify-pretty-compact";
import { SDKAttributeSchema } from "back-end/types/organization";
import { useAttributeSchema } from "@/services/features";
import { DocLink } from "@/components/DocLink";
import Code from "../Code";

function phpArrayFormat(json: unknown) {
  return stringify(json)
    .replace(/\{/g, "[")
    .replace(/\}/g, "]")
    .replace(/:/g, " =>");
}

function swiftArrayFormat(json: unknown) {
  return stringify(json).replace(/\{/, "[").replace(/\}/g, "]");
}

function indentLines(code: string, indent: number | string = 2) {
  const spaces = typeof indent === "string" ? indent : " ".repeat(indent);
  return code.split("\n").join("\n" + spaces);
}

function getExampleAttributes(attributeSchema?: SDKAttributeSchema) {
  if (!attributeSchema?.length) return {};

  // eslint-disable-next-line
  const exampleAttributes: any = {};
  attributeSchema.forEach(({ property, datatype, enum: enumList }) => {
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

export default function GrowthBookSetupCodeSnippet({
  language,
  apiKey,
  apiHost,
  useStreaming = false,
  encryptionKey,
}: {
  language: SDKLanguage;
  apiKey: string;
  apiHost: string;
  useStreaming?: boolean;
  encryptionKey?: string;
}) {
  const featuresEndpoint = apiHost + "api/features/" + apiKey;

  const attributeSchema = useAttributeSchema();
  const exampleAttributes = getExampleAttributes(attributeSchema);

  if (language === "javascript") {
    return (
      <>
        Create a GrowthBook instance
        <Code
          language="javascript"
          code={`
import { GrowthBook } from "@growthbook/growthbook";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
            useStreaming ? `\n  streaming: true,` : ""
          }${
            encryptionKey
              ? `\n  encryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
          }
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    // TODO: use your real analytics tracking system
    analytics.track("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    });
  }
});
`.trim()}
        />
        Set targeting attributes
        <Code
          language="javascript"
          code={`
// TODO: replace with real targeting attribute values
growthbook.setAttributes(${stringify(exampleAttributes)});
`.trim()}
        />
      </>
    );
  }
  if (language === "react") {
    return (
      <>
        Create a GrowthBook instance
        <Code
          language="tsx"
          code={`
import { GrowthBook } from "@growthbook/growthbook-react";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${
            useStreaming ? `\n  streaming: true,` : ""
          }${
            encryptionKey
              ? `\n  encryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
          }
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    // TODO: use your real analytics tracking system
    analytics.track("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    });
  }
});
`.trim()}
        />
        Set targeting attributes
        <Code
          language="tsx"
          code={`
// TODO: replace with real targeting attribute values
growthbook.setAttributes(${stringify(exampleAttributes)});
`.trim()}
        />
        Wrap app in a GrowthBookProvider
        <Code
          language="tsx"
          code={`
import { GrowthBookProvider } from "@growthbook/growthbook-react";

export default function MyApp() {
  return (
    <GrowthBookProvider growthbook={growtbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}
`.trim()}
        />
      </>
    );
  }
  if (language === "nodejs") {
    return (
      <>
        Add a middleware before any routes that will use GrowthBook
        <Code
          language="javascript"
          code={`
const { GrowthBook } = require("@growthbook/growthbook");
const fetch = require("node-fetch");
${encryptionKey ? `const subtleCrypto = require('node:crypto')\n` : ""}
app.use(function(req, res, next) {
  // Create a GrowthBook Context
  req.growthbook = new GrowthBook({
    apiHost: ${JSON.stringify(apiHost)},
    clientKey: ${JSON.stringify(apiKey)},${
            useStreaming ? `\n    streaming: true,` : ""
          }${
            encryptionKey
              ? `\n    encryptionKey: ${JSON.stringify(
                  encryptionKey
                )},\n    crypto: subtleCrypto,`
              : ""
          }
    enableDevMode: true,
    fetch: fetch,
    trackingCallback: (experiment, result) => {
      // TODO: use your real analytics tracking system
      analytics.track("Viewed Experiment", {
        experimentId: experiment.key,
        variationId: result.variationId
      });
    },
    // TODO: replace with real targeting attribute values
    attributes: ${indentLines(stringify(exampleAttributes), 4)}
  });

  // Clean up at the end of the request
  res.on('close', () => req.growthbook.destroy());

  // Wait for features to load (will be cached in-memory for future requests)
  req.growthbook.waitForFeatures()
    .then(() => next())
    .catch((e) => {
      console.error("Failed to load features from GrowthBook", e));
      next();
    })
})
`.trim()}
        />
      </>
    );
  }
  if (language === "android") {
    return (
      <>
        Define targeting attributes
        <Code
          language="kotlin"
          code={`
// TODO: replace with real targeting attribute values
val attrs = HashMap<String, Any>()
${Object.keys(exampleAttributes)
  .map((k) => {
    return `attrs.put("${k}", ${JSON.stringify(exampleAttributes[k])})`;
  })
  .join("\n")}
`.trim()}
        />
        Create GrowthBook instance
        <Code
          language="kotlin"
          code={`
import com.sdk.growthbook.GBSDKBuilder

val gb = GBSDKBuilder(
  apiKey = "${apiKey || "MY_SDK_KEY"}",
  hostURL = "${apiHost}",
  attributes = attrs,
  trackingCallback = { gbExperiment, gbExperimentResult ->
    // TODO: Use your real analytics tracking system
    analytics.track("Viewed Experiment", buildJsonObject {
      put("experimentId", gbExperiment.key)
      put("variationId" gbExperimentResult.variationId)
  });
  }
).initialize()`.trim()}
        />
      </>
    );
  }
  if (language === "ios") {
    return (
      <>
        Define targeting attributes
        <Code
          language="swift"
          code={`
// TODO: replace with real targeting attribute values
var attrs = ${swiftArrayFormat(exampleAttributes)}
    `.trim()}
        />
        Create GrowthBook instance
        <Code
          language="swift"
          code={`
var gb: GrowthBookSDK = GrowthBookBuilder(
  url: "${featuresEndpoint}",
  attributes: attrs,
  trackingCallback: { experiment, experimentResult in 
    // TODO: track in your analytics system
    print("Viewed Experiment", experiment.key, experimentResult.variationId)
}
).initializer()
    `.trim()}
        />
      </>
    );
  }
  if (language === "go") {
    return (
      <>
        Helper function to load features from the GrowthBook API
        <Code
          language="go"
          code={`
package main

import (
	"encoding/json"
	"io"
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
	resp, err := http.Get("${featuresEndpoint}")
	if err != nil {
		log.Println(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	// Just return the features map from the API response
	apiResp := &GrowthBookApiResp{}
	_ = json.Unmarshal(body, apiResp)
	return apiResp.Features
}
            `.trim()}
        />
        Create GrowthBook instance
        <Code
          language="go"
          code={`
package main

import (
	growthbook "github.com/growthbook/growthbook-golang"
	"log"
)

func main() {
	featureMap := GetFeatureMap()
	features := growthbook.ParseFeatureMap(featureMap)

	context := growthbook.NewContext().
		WithFeatures(features).
		// TODO: Real targeting attribute values
		WithAttributes(growthbook.Attributes${indentLines(
      JSON.stringify(exampleAttributes, null, "\t"),
      "\t\t"
    )
      .replace(/null/g, "nil")
      .replace(/\n(\t+)\}/, ",\n$1}")}).
		// TODO: Track in your analytics system
		WithTrackingCallback(func(experiment *growthbook.Experiment, result *growthbook.ExperimentResult) {
			log.Println("Viewed Experiment", experiment.Key, result.VariationID)
		})
	gb := growthbook.New(context)
}
            `.trim()}
        />
      </>
    );
  }
  if (language === "ruby") {
    return (
      <>
        Get features from the GrowthBook API
        <Code
          language="ruby"
          code={`
require 'uri'
require 'net/http'
require 'json'

uri = URI('${featuresEndpoint}')
res = Net::HTTP.get_response(uri)
features = res.is_a?(Net::HTTPSuccess) ? JSON.parse(res.body)['features'] : nil
            `.trim()}
        />
        Tracking callback when users are put into an experiment
        <Code
          language="ruby"
          code={`
class MyImpressionListener
  def on_experiment_viewed(experiment, result)
    # TODO: track in your real analytics system
    Analytics.track(
      user_id: '123abc',
      event: 'Viewed Experiment',
      properties: { 
        variationId: result.variation_id,
        experimentId: experiment.key
      })
  end
end
            `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="ruby"
          code={`
require 'growthbook'

# Create a context for the current user/request
gb = Growthbook::Context.new(
  features: features,
  # TODO: Real targeting attribute values
  attributes: ${indentLines(stringify(exampleAttributes), 2).replace(
    /: null/g,
    ": nil"
  )},
  listener: MyImpressionListener.new
)
            `.trim()}
        />
      </>
    );
  }
  if (language === "php") {
    return (
      <>
        Targeting attributes
        <Code
          language="php"
          code={`
// TODO: Use real targeting attribute values
$attributes = ${phpArrayFormat(exampleAttributes)};
            `.trim()}
        />
        Get features from GrowthBook API
        <Code
          language="php"
          code={`
const FEATURES_ENDPOINT = '${featuresEndpoint}';
$apiResponse = json_decode(file_get_contents(FEATURES_ENDPOINT), true);
$features = $apiResponse["features"];
            `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="php"
          code={`
use Growthbook\\Growthbook;

$growthbook = Growthbook::create()
  ->withAttributes($attributes)
  ->withFeatures($features)
  ->withTrackingCallback(function ($experiment, $result) {
    // TODO: track in your real analytics system
    Segment::track([
      "userId" => "abc123",
      "event" => "Viewed Experiment",
      "properties" => [
        "variationId" => $result->variationId,
        "experimentId" => $experiment->key
      ]
    ]);
  });
            `.trim()}
        />
      </>
    );
  }
  if (language === "python") {
    return (
      <>
        Get features from the GrowthBook API
        <Code
          language="python"
          code={`
import requests

apiResp = requests.get("${featuresEndpoint}")
features = apiResp.json()["features"]
            `.trim()}
        />
        Define targeting attributes
        <Code
          language="python"
          code={`
# TODO: Real targeting attribute values
attributes = ${stringify(exampleAttributes)
            .replace(/: true/g, ": True")
            .replace(/: false/g, ": False")
            .replace(/: null/g, ": None")}
            `.trim()}
        />
        Callback when a user is put into an experiment
        <Code
          language="python"
          code={`
def on_experiment_viewed(experiment, result):
  # Use whatever event tracking system you want
  analytics.track('usr_123abc', 'Viewed Experiment', {
    'experimentId': experiment.key,
    'variationId': result.variationId
  })
            `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="python"
          code={`
from growthbook import GrowthBook

gb = GrowthBook(
  attributes = attributes,
  features = features,
  trackingCallback = on_experiment_viewed
)
            `.trim()}
        />
      </>
    );
  }
  if (language === "java") {
    return (
      <>
        Get features from the GrowthBook API
        <Code
          language="java"
          code={`
URI featuresEndpoint = new URI("${featuresEndpoint}");
HttpRequest request = HttpRequest.newBuilder().uri(featuresEndpoint).GET().build();
HttpResponse<String> response = HttpClient.newBuilder().build()
    .send(request, HttpResponse.BodyHandlers.ofString());
String featuresJson = new JSONObject(response.body()).get("features").toString();
            `.trim()}
        />
        Define targeting attributes
        <Code
          language="java"
          code={`
// Get user attributes as a JSON string
JSONObject userAttributesObj = new JSONObject();
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `userAttributesObj.put(${JSON.stringify(key)}, ${JSON.stringify(
      value
    )});`;
  })
  .join("\n")}
String userAttributesJson = userAttributesObj.toString();
            `.trim()}
        />
        Callback when a user is put into an experiment
        <Code
          language="java"
          code={`
TrackingCallback trackingCallback = new TrackingCallback() {
  public <ValueType> void onTrack(
      Experiment<ValueType> experiment,
      ExperimentResult<ValueType> experimentResult
  ) {
    // TODO: Use your real analytics tracking system
    analytics.enqueue(TrackMessage.builder("Viewed Experiment")
      .userId("usr_abc123")
      .properties(ImmutableMap.builder()
          .put("experimentId", experiment.key)
          .put("variationId", experimentResult.variationId)
          .build()
      )
    );
  }
};

            `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="java"
          code={`
GBContext context = GBContext.builder()
    .featuresJson(featuresJson)
    .attributesJson(userAttributesJson)
    .trackingCallback(trackingCallback)
    .build();
GrowthBook growthBook = new GrowthBook(context);
            `.trim()}
        />
      </>
    );
  }
  if (language === "flutter") {
    return (
      <>
        Define targeting attributes
        <Code
          language="dart"
          code={`
val attrs = HashMap<String, Any>()
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `attrs.put(${JSON.stringify(key)}, ${JSON.stringify(value)})`;
  })
  .join("\n")}
`.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="dart"
          code={`
final GrowthBookSDK gb = GBSDKBuilderApp(
  hostURL: '${apiHost}',
  apiKey: "${apiKey}",
  attributes: {
    attrs
  },
  growthBookTrackingCallBack: (gbExperiment, gbExperimentResult) {
    // TODO: Use your real analytics tracking system
    Analytics.track(
      eventName: 'Viewed Experiment',
      properties: {
        'experimentId': gbExperiment.key,
        'variationId': gbExperimentResult.variationId,
      },
    );
  },
).initialize();
`.trim()}
        />
      </>
    );
  }
  if (language === "csharp") {
    return (
      <>
        Get features from the GrowthBook API
        <Code
          language="csharp"
          code={`
using GrowthBook;

// Fetch feature flags from the GrowthBook API
var features = new Dictionary<string, Feature>{};
public class FeaturesResult
{
    public HttpStatusCode Status { get; set; }
    public IDictionary<string, Feature>? Features { get; set; }
    public DateTimeOffset? DateUpdated { get; set; }
}
var url = "${featuresEndpoint}";
var response = await client.GetAsync(url);
if (response.IsSuccessStatusCode)
{
    var content = await response.Content.ReadAsStringAsync();
    var featuresResult = JsonConvert.DeserializeObject<FeaturesResult>(content);
    features = featuresResult.Features;
}
    `.trim()}
        />
        Define targeting attributes
        <Code
          language="csharp"
          code={`
// TODO: real targeting attribute values
var attrs = new JObject();
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `attrs.Add(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
  })
  .join("\n")}
    `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="csharp"
          code={`
var context = new Context
{
    Enabled = true,
    Features = features,
    Attributes = attrs
};
var gb = new GrowthBook.GrowthBook(context);
    `.trim()}
        />
      </>
    );
  }

  return (
    <p>
      We don&apos;t have an SDK for your language yet, but we do have extensive
      documentation if you want to build your own and contribute it back to the
      community! <DocLink docSection="buildYourOwn">View Documentation</DocLink>
    </p>
  );
}
