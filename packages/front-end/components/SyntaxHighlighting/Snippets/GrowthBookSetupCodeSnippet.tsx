import { SDKLanguage } from "back-end/types/sdk-connection";
import { DocLink } from "@/components/DocLink";
import Code from "../Code";

export default function GrowthBookSetupCodeSnippet({
  language,
  apiKey,
  apiHost,
  encryptionKey,
}: {
  language: SDKLanguage;
  apiKey: string;
  apiHost: string;
  encryptionKey?: string;
}) {
  const featuresEndpoint = apiHost + "/api/features/" + apiKey;
  const trackingComment = "TODO: Use your real analytics tracking system";

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
            encryptionKey
              ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
          }
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    // ${trackingComment}
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    });
  }
});

// Wait for features to be available
await growthbook.loadFeatures({ autoRefresh: true });
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
            encryptionKey
              ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
          }
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    // ${trackingComment}
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.variationId
    });
  }
});
`.trim()}
        />
        Wrap app in a GrowthBookProvider
        <Code
          language="tsx"
          code={`
import { useEffect } from "react";
import { GrowthBookProvider } from "@growthbook/growthbook-react";

export default function MyApp() {
  useEffect(() => {
    // Load features asynchronously when the app renders
    growthbook.loadFeatures();
  }, []);

  return (
    <GrowthBookProvider growthbook={growthbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}
`.trim()}
        />
        If you are using <strong>Next.js</strong>,{" "}
        <a
          href="https://github.com/growthbook/examples/tree/main/next-js"
          target="_blank"
          rel="noreferrer"
        >
          check out our sample app on GitHub
        </a>{" "}
        with examples of using GrowthBook with SSR, API routes, static pages,
        and more.
      </>
    );
  }
  if (language === "nodejs") {
    return (
      <>
        Add some polyfills for missing browser APIs
        <Code
          language="javascript"
          code={`
const { setPolyfills } = require("@growthbook/growthbook");
setPolyfills({
  // Required for Node 17 or earlier
  fetch: require("cross-fetch"),${
    encryptionKey
      ? `
  // Required for Node 18 or earlier
  SubtleCrypto: require("node:crypto").webcrypto.subtle,`
      : ""
  }
  // Optional, can make feature rollouts faster
  EventSource: require("eventsource")
})
        `.trim()}
        />
        Add a middleware before any routes that will use GrowthBook
        <Code
          language="javascript"
          code={`
const { GrowthBook } = require("@growthbook/growthbook");

app.use(function(req, res, next) {
  // Create a GrowthBook Context
  req.growthbook = new GrowthBook({
    apiHost: ${JSON.stringify(apiHost)},
    clientKey: ${JSON.stringify(apiKey)},${
            encryptionKey
              ? `\n    decryptionKey: ${JSON.stringify(encryptionKey)}`
              : ""
          }
    enableDevMode: true,
    trackingCallback: (experiment, result) => {
      // ${trackingComment}
      console.log("Viewed Experiment", {
        experimentId: experiment.key,
        variationId: result.variationId
      });
    }
  });

  // Clean up at the end of the request
  res.on('close', () => req.growthbook.destroy());

  // Wait for features to load (will be cached in-memory for future requests)
  req.growthbook.loadFeatures()
    .then(() => next())
    .catch((e) => {
      console.error("Failed to load features from GrowthBook", e);
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
        Create GrowthBook instance
        <Code
          language="kotlin"
          code={`
import com.sdk.growthbook.GBSDKBuilder

val gb = GBSDKBuilder(
  apiKey = "${apiKey || "MY_SDK_KEY"}",
  hostURL = "${apiHost}/",
  trackingCallback = { gbExperiment, gbExperimentResult ->
    // ${trackingComment}
    println("Viewed Experiment")
    println("Experiment Id: " + gbExperiment.key)
    println("Variation Id: " + gbExperimentResult.variationId)
  }
).initialize()`.trim()}
        />
      </>
    );
  }
  if (language === "ios") {
    return (
      <>
        Create GrowthBook instance
        <Code
          language="swift"
          code={`
var gb: GrowthBookSDK = GrowthBookBuilder(
  url: "${featuresEndpoint}",${
            encryptionKey ? `\n  encryptionKey: "${encryptionKey}",` : ""
          }
  trackingCallback: { experiment, experimentResult in 
    // ${trackingComment}
    print("Viewed Experiment")
    print("Experiment Id: ", experiment.key)
    print("Variation Id: ", experimentResult.variationId)
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
		// ${trackingComment}
		WithTrackingCallback(func(experiment *growthbook.Experiment, result *growthbook.ExperimentResult) {
			log.Println("Viewed Experiment")
			log.Println("Experiment Id", experiment.Key)
			log.Println("Variation Id", result.VariationID)
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
    # ${trackingComment}
    puts "Viewed Experiment"
    puts "Experiment Id: #{experiment.key}"
    puts "Variation Id: #{result.variationId}"
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
        Get features from the GrowthBook API
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
  ->withFeatures($features)
  ->withTrackingCallback(function ($experiment, $result) {
    // ${trackingComment}
    print_r([
      "event" => "Viewed Experiment",
      "properties" => [
        "experimentId" => $experiment->key,
        "variationId" => $result->variationId
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
        Callback when a user is put into an experiment
        <Code
          language="python"
          code={`
def on_experiment_viewed(experiment, result):
  # ${trackingComment}
  print("Viewed Experiment")
  print("Experiment Id: " + experiment.key)
  print("Variation Id: " + result.variationId)
            `.trim()}
        />
        Create a GrowthBook instance
        <Code
          language="python"
          code={`
from growthbook import GrowthBook

gb = GrowthBook(
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
        Callback when a user is put into an experiment
        <Code
          language="java"
          code={`
TrackingCallback trackingCallback = new TrackingCallback() {
  public <ValueType> void onTrack(
      Experiment<ValueType> experiment,
      ExperimentResult<ValueType> experimentResult
  ) {
    // ${trackingComment}
    System.out.println("Viewed Experiment")
    System.out.println("Experiment Id: " + experiment.key)
    System.out.println("Variation Id: " + experimentResult.variationId)
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
        Create a GrowthBook instance
        <Code
          language="dart"
          code={`
final GrowthBookSDK gb = GBSDKBuilderApp(
  hostURL: '${apiHost}/',
  apiKey: "${apiKey}",
  growthBookTrackingCallBack: (gbExperiment, gbExperimentResult) {
    // ${trackingComment}
    print("Viewed Experiment")
    print("Experiment Id: " + gbExperiment.key)
    print("Variation Id: " + gbExperimentResult.variationId)
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
        Create a GrowthBook instance
        <Code
          language="csharp"
          code={`
var context = new Context
{
    Enabled = true,
    Features = features
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
