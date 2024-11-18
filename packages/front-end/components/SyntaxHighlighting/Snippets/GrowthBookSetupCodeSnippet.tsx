import { SDKLanguage } from "back-end/types/sdk-connection";
import { useState } from "react";
import { paddedVersionString } from "@growthbook/growthbook";
import { FaExternalLinkAlt } from "react-icons/fa";
import { DocLink } from "@/components/DocLink";
import SelectField from "@/components/Forms/SelectField";
import Code from "@/components/SyntaxHighlighting/Code";

export default function GrowthBookSetupCodeSnippet({
  language,
  version,
  apiKey,
  apiHost,
  encryptionKey,
  remoteEvalEnabled,
}: {
  language: SDKLanguage;
  version?: string;
  apiKey: string;
  apiHost: string;
  encryptionKey?: string;
  remoteEvalEnabled: boolean;
}) {
  const featuresEndpoint = apiHost + "/api/features/" + apiKey;
  const trackingComment = "TODO: 使用真实的分析跟踪系统";

  const [eventTracker, setEventTracker] = useState("GA4");

  if (language.match(/^nocode/)) {
    return (
      <>
        <div className="form-inline mb-3">
          <SelectField
            label="事件跟踪系统"
            labelClassName="mr-2"
            options={[
              { label: "谷歌分析4", value: "GA4" },
              { label: "Segment.io", value: "segment" },
              { label: "其他", value: "other" },
            ]}
            sort={false}
            value={eventTracker}
            onChange={(value) => setEventTracker(value)}
          />
        </div>

        {eventTracker === "other" ? (
          <>
            您需要在上述GrowthBook代码片段之前添加自己的自定义实验跟踪回调函数：
            <Code
              language="html"
              code={`
<script>
window.growthbook_config = window.growthbook_config || {};
window.growthbook_config.trackingCallback = (experiment, result) => {
  customEventTracker("Viewed Experiment", {
    experiment_id: experiment.key,
    variation_id: result.key
  })
};
</script>
          `.trim()}
            />
          </>
        ) : (
          <div>
            事件将在{eventTracker}中自动跟踪。无需配置。
          </div>
        )}
      </>
    );
  }

  if (language === "javascript") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    return (
      <>
        创建一个GrowthBook实例
        <Code
          language="javascript"
          code={`
import { GrowthBook } from "@growthbook/growthbook";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${encryptionKey
              ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
            }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  trackingCallback: (experiment, result) => {
    // ${trackingComment}
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.key
    });
  }
});

// Wait for features to be available${useInit
              ? `\nawait growthbook.init({ streaming: true });`
              : `\nawait growthbook.loadFeatures();`
            }
`.trim()}
        />
      </>
    );
  }
  if (language === "react") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    return (
      <>
        创建一个GrowthBook实例
        <Code
          language="tsx"
          code={`
import { GrowthBook } from "@growthbook/growthbook-react";

const growthbook = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},${encryptionKey
              ? `\n  decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
            }${remoteEvalEnabled ? `\n  remoteEval: true,` : ""}
  enableDevMode: true,${!useInit ? `\n  subscribeToChanges: true,` : ""}
  trackingCallback: (experiment, result) => {
    // ${trackingComment}
    console.log("Viewed Experiment", {
      experimentId: experiment.key,
      variationId: result.key
    });
  }
});
`.trim()}
        />
        将应用包裹在GrowthBookProvider中
        <Code
          language="tsx"
          code={`
import { useEffect } from "react";
import { GrowthBookProvider } from "@growthbook/growthbook-react";

export default function MyApp() {
  useEffect(() => {
    // Load features asynchronously when the app renders${useInit
              ? `\n    growthbook.init({ streaming: true });`
              : `\n    growthbook.loadFeatures();`
            }
  }, []);

  return (
    <GrowthBookProvider growthbook={growthbook}>
      <MyComponent/>
    </GrowthBookProvider>
  )
}
`.trim()}
        />
        如果您正在使用 <strong>Next.js</strong>，{" "}
        <a
          href="https://github.com/growthbook/examples/tree/main/next-js"
          target="_blank"
          rel="noreferrer"
        >查看我们在GitHub上的示例应用</a>，其中包含了使用GrowthBook进行服务器端渲染、API路由、静态页面等的示例。
      </>
    );
  }
  if (language === "nodejs") {
    const useInit =
      paddedVersionString(version) >= paddedVersionString("1.0.0");
    return (
      <>
        为缺失的浏览器API添加一些补丁
        <Code
          language="javascript"
          code={`
const { setPolyfills } = require("@growthbook/growthbook");
setPolyfills({
  // Required for Node 17 or earlier
  fetch: require("cross-fetch"),${encryptionKey
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
        在任何将使用GrowthBook的路由之前添加一个中间件
        <Code
          language="javascript"
          code={`
const { GrowthBook } = require("@growthbook/growthbook");

app.use(function(req, res, next) {
  // Create a GrowthBook Context
  req.growthbook = new GrowthBook({
    apiHost: ${JSON.stringify(apiHost)},
    clientKey: ${JSON.stringify(apiKey)},${encryptionKey
              ? `\n    decryptionKey: ${JSON.stringify(encryptionKey)},`
              : ""
            }
    trackingCallback: (experiment, result) => {
      // ${trackingComment}
      console.log("Viewed Experiment", {
        experimentId: experiment.key,
        variationId: result.key
      });
    }
  });

  // Clean up at the end of the request
  res.on('close', () => req.growthbook.destroy());

  // Wait for features to load (will be cached in-memory for future requests)${useInit
              ? `\n  req.growthbook.init({ timeout: 1000 })`
              : `\n  req.growthbook.loadFeatures({ timeout: 1000 })`
            }
    .then(() => next())
})
`.trim()}
        />
      </>
    );
  }
  if (language === "android") {
    return (
      <>
        创建GrowthBook实例
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
        创建GrowthBook实例
        <Code
          language="swift"
          code={`
var gb: GrowthBookSDK = GrowthBookBuilder(
  url: "${featuresEndpoint}",${encryptionKey ? `\n  encryptionKey: "${encryptionKey}",` : ""
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
        用于从GrowthBook API加载特性的辅助函数
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
        创建GrowthBook实例
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
        从GrowthBook API获取特性
        <Code
          language="ruby"
          code={`
require 'growthbook'

# Fetch features from a GrowthBook instance
# You should cache this in Redis or similar in production
features_repository = Growthbook::FeatureRepository.new(
  endpoint: '${featuresEndpoint}'${encryptionKey
              ? `,
  decryption_key: '${encryptionKey}'`
              : ""
            }
)
features = features_repository.fetch
            `.trim()}
        />
        当用户参与实验时的跟踪回调
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
        创建一个GrowthBook实例
        <Code
          language="ruby"
          code={`
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
        创建一个GrowthBook实例
        <Code
          language="php"
          code={`
use Growthbook\\Growthbook;

$growthbook = Growthbook::create()
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
        从GrowthBook API加载特性
        <Code
          language="php"
          code={`
// Cache features across requests (any psr-16 library will work)
$cache = new \\Cache\\Adapter\\Apcu\\ApcuCachePool();
$growthbook->withCache($cache);

$growthbook->loadFeatures(
  "${apiKey || "MY_SDK_KEY"}", // Client Key
  "${apiHost}"${encryptionKey
              ? `, // API Host
  "${encryptionKey}" // Decryption Key`
              : " // API Host"
            }
);
            `.trim()}
        />
      </>
    );
  }
  if (language === "python") {
    return (
      <>
        当用户参与实验时的回调函数
        <Code
          language="python"
          code={`
def on_experiment_viewed(experiment, result):
  # ${trackingComment}
  print("Viewed Experiment")
  print("Experiment Id: " + experiment.key)
  print("Variation Id: " + result.key)
            `.trim()}
        />
        创建一个GrowthBook实例并加载特性
        <Code
          language="python"
          code={`
from growthbook import GrowthBook

gb = GrowthBook(
  api_host = "${apiHost}",
  client_key = "${apiKey || "MY_SDK_KEY"}",${encryptionKey
              ? `
  decryption_key = "${encryptionKey}",`
              : ""
            }
  on_experiment_viewed = on_experiment_viewed
)

gb.load_features()
            `.trim()}
        />
      </>
    );
  }
  if (language === "java") {
    return (
      <>
        从GrowthBook API获取特性
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
        当用户参与实验时的回调
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
        创建一个GrowthBook实例
        <Code
          language="java"
          code={
            encryptionKey
              ? `
GBContext context = GBContext.builder()
    .featuresJson(featuresJson)
    .attributesJson(userAttributesObj.toString()) // Optional
    .encryptionKey("${encryptionKey}") // You may want to store this in an environment variable
    .trackingCallback(trackingCallback)
    .build();
GrowthBook growthBook = new GrowthBook(context);
            `.trim()
              : `
GBContext context = GBContext.builder()
    .featuresJson(featuresJson)
    .attributesJson(userAttributesObj.toString()) // Optional
    .trackingCallback(trackingCallback)
    .build();
GrowthBook growthBook = new GrowthBook(context);
            `.trim()
          }
        />
      </>
    );
  }
  if (language === "flutter") {
    return (
      <>
        创建一个GrowthBook实例
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
        从GrowthBook API获取特性
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
        创建一个GrowthBook实例
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
  if (language === "elixir") {
    return (
      <>
        从GrowthBook API获取特性
        <Code
          language="elixir"
          code={`
:inets.start()
:ssl.start()

url = '${featuresEndpoint}'
headers = [{'accept', 'application/json'}]

http_request_opts = [
  ssl: [
    verify: :verify_peer,
    cacerts: :public_key.cacerts_get(),
    customize_hostname_check: [
      match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
    ]
  ]
]

{:ok, {_, _, json}} = :httpc.request(:get, {url, headers}, http_request_opts, [])

%{"status" => 200, "features" => features} = Jason.decode!(json)
features = GrowthBook.Config.features_from_config(features)
          `.trim()}
        />
      </>
    );
  }
  if (language === "edge-cloudflare") {
    return (
      <>
        <p>
          我们的 <strong>边缘应用</strong> 在边缘提供了一站式的可视化编辑器和URL重定向实验功能，且不会出现与前端实验相关的闪烁问题。它作为您的应用程序和最终用户之间的智能代理层运行。它还可以将完全加载的前端SDK注入到渲染页面中，这意味着不需要额外的网络请求。
        </p>

        <div className="h4 mt-4 mb-3">
          步骤1：设置一个Cloudflare Workers项目
        </div>
        <p>
          请参阅Cloudflare Workers的官方 <a
            href="https://developers.cloudflare.com/workers/get-started/guide/"
            target="_blank"
            rel="noreferrer"
          >
            入门指南 <FaExternalLinkAlt />
          </a> 来设置您的项目。或者查看我们的 <a
            href="https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-cloudflare/example"
            target="_blank"
            rel="noreferrer"
          >示例实现 <FaExternalLinkAlt />
          </a>。
        </p>

        <div className="h4 mt-4 mb-3">
          步骤2：实现我们的边缘应用请求处理程序
        </div>
        <p>
          要运行边缘应用，请将我们的Cloudflare请求处理程序添加到您的项目中：
        </p>
        <Code
          language="javascript"
          code={`
import { handleRequest } from "@growthbook/edge-cloudflare";

export default {
  fetch: async function (request, env, ctx) {
    return await handleRequest(request, env);
  },
};
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Step 3: Set up environment variables</div>
        <p>
          编辑您的 <code>wrangler.toml</code> 文件，至少添加以下必填字段：
        </p>
        <Code
          language="bash"
          filename="wrangler.toml"
          code={`
[vars]
PROXY_TARGET="https://internal.mysite.io"  # The non-edge URL to your website
GROWTHBOOK_API_HOST=${JSON.stringify(apiHost)}
GROWTHBOOK_CLIENT_KEY=${JSON.stringify(apiKey)}${encryptionKey
              ? `\nGROWTHBOOK_DECRYPTION_KEY=${JSON.stringify(encryptionKey)}`
              : ""
            }
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">Step 4: Set up payload caching</div>
        <p>
          设置一个 <strong>Cloudflare KV</strong> 存储，并使用GrowthBook <strong>SDK网络钩子</strong> 来保持GrowthBook和您的Cloudflare Worker之间的特性和实验值同步。这将消除从边缘到GrowthBook的网络请求。
        </p>

        <div className="h4 mt-4 mb-3">Further customization</div>
        <ul>
          <li>
            通过设置 <code>{`ENABLE_STICKY_BUCKETING="true"`}</code> 来在边缘和浏览器中启用基于Cookie的粘性分桶。
          </li>
          <li>
            通过设置 <code>{`ENABLE_STREAMING="true"`}</code> 来在浏览器中启用流模式。
          </li>
          <li>
            为您的浏览器SDK和/或边缘工作者添加自定义跟踪回调。
          </li>
          <li>
            为您的浏览器SDK和/或边缘工作者添加自定义跟踪回调。
          </li>
        </ul>
        <p>
          请参阅 <DocLink docSection="cloudflare">Cloudflare Workers文档</DocLink> 以获取更多说明。
        </p>
      </>
    );
  }
  if (language === "edge-fastly") {
    return (
      <>
        <p>
          我们的 <strong>边缘应用</strong> 在边缘提供了一站式的可视化编辑器和URL重定向实验功能，且不会出现与前端实验相关的闪烁问题。它作为您的应用程序和最终用户之间的智能代理层运行。它还可以将完全加载的前端SDK注入到渲染页面中，这意味着不需要额外的网络请求。
        </p>

        <div className="h4 mt-4 mb-3">
          步骤1：为TypeScript或JavaScript设置一个Fastly Compute项目
        </div>
        <p>
          请参阅Fastly Compute的官方 <a
            href="https://www.fastly.com/documentation/guides/compute/"
            target="_blank"
            rel="noreferrer"
          >开发者指南 <FaExternalLinkAlt />
          </a>{" "}
          to set up your project. Or have a look at our{" "}
          <a
            href="https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-fastly/example"
            target="_blank"
            rel="noreferrer"
          >
            示例实现 <FaExternalLinkAlt />
          </a>
          .
        </p>

        <div className="h4 mt-4 mb-3">
          步骤2：实现我们的边缘应用请求处理程序
        </div>
        <p>
          要运行边缘应用，请将我们的Fastly请求处理程序添加到您的项目中：
        </p>
        <Code
          language="javascript"
          code={`
/// <reference types="@fastly/js-compute" />
import { ConfigStore } from "fastly:config-store";
import { KVStore } from "fastly:kv-store";
import { gbHandleRequest, getConfigEnvFromStore } from "@growthbook/edge-fastly";

addEventListener("fetch", (event) => event.respondWith(handleRequest(event)));

async function handleRequest(event) {
  const envVarsStore = new ConfigStore("env_vars");
  const env = getConfigEnvFromStore(envVarsStore);

  const config = {
    // Name of Fastly backend pointing to your GrowthBook API Endpoint
    apiHostBackend: "api_host",
    
    // Map of proxy origins to named Fastly backends
    backends: { "https://internal.mysite.io": "my_site" },
    
    // Add one or more caching mechanisms (optional):
    gbCacheStore: new KVStore("gb_cache"),
    gbPayloadStore: new KVStore("gb_payload"),
  };

  return await gbHandleRequest(event.request, env, config);
}
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">步骤3：设置后端（源）</div>
        <p>
          通过在Fastly控制台为您的计算服务设置后端（源），允许您的工作者连接到您的源站点和GrowthBook API。
          <ul>
            <li className="mt-3">
              在Fastly中，创建一个名为 <code>api_host</code> 的后端，指向您的API主机（<code>{apiHost}</code>）。
              <div>
                在您的代码中，通过 <code>config.apiHostBackend</code> 将此字符串传递给您的请求处理程序，如 <em>步骤2</em> 所示。
              </div>
            </li>
            <li className="mt-3">
              在Fastly中，创建一个或多个指向您的站点源的后端。
              <div>
                在您的代码中，创建一个将您的源URL映射到其命名后端的对象。通过 <code>config.backends</code> 将此对象传递给您的请求处理程序，如 <em>步骤2</em> 所示。
              </div>
            </li>
          </ul>
        </p>

        <div className="h4 mt-4 mb-3">步骤4：设置环境变量</div>
        <p>
          在Fastly控制台创建一个名为 <code>env_vars</code> 的配置存储，并将其链接到您的服务。然后，至少添加以下必填的键/值对：
        </p>
        <Code
          language="bash"
          code={`
PROXY_TARGET="https://internal.mysite.io"  # The non-edge URL to your website
GROWTHBOOK_API_HOST=${JSON.stringify(apiHost)}
GROWTHBOOK_CLIENT_KEY=${JSON.stringify(apiKey)}${encryptionKey
              ? `\nGROWTHBOOK_DECRYPTION_KEY=${JSON.stringify(encryptionKey)}`
              : ""
            }
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">步骤5：设置负载缓存</div>
        <p>
          设置一个 <strong>Fastly KV</strong> 存储，并使用GrowthBook <strong>SDK网络钩子</strong> 来保持GrowthBook和您的Fastly工作者之间的特性和实验值同步。这将消除从边缘到GrowthBook的网络请求。
        </p>

        <div className="h4 mt-4 mb-3">进一步定制</div>
        <ul>
          <li>
            通过设置 <code>{`RUN_URL_REDIRECT_EXPERIMENTS="everywhere"`}</code> 来在边缘启用URL重定向实验（默认关闭）。
          </li>
          <li>
            通过设置 <code>{`ENABLE_STICKY_BUCKETING="true"`}</code> 来在边缘和浏览器中启用基于Cookie的粘性分桶。
          </li>
          <li>
            通过设置 <code>{`ENABLE_STREAMING="true"`}</code> 来在浏览器中启用流模式。
          </li>
          <li>
            为您的浏览器SDK和/或边缘工作者添加自定义跟踪回调。
          </li>
        </ul>
        <p>
          请参阅 <DocLink docSection="fastly">Fastly计算文档</DocLink> 以获取更多说明。
        </p>
      </>
    );
  }
  if (language === "edge-lambda") {
    return (
      <>
        <p>
          我们的 <strong>边缘应用</strong> 在边缘提供了一站式的可视化编辑器和URL重定向实验功能，且不会出现与前端实验相关的闪烁问题。它作为您的应用程序和最终用户之间的智能代理层运行。它还可以将完全加载的前端SDK注入到渲染页面中，这意味着不需要额外的网络请求。
        </p>

        <div className="h4 mt-4 mb-3">步骤1：设置一个Lambda@Edge项目</div>
        <p>
          请参阅AWS的官方 <a
            href="https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-edge-how-it-works-tutorial.html"
            target="_blank"
            rel="noreferrer"
          >
            教程：创建一个基本的Lambda@Edge函数 <FaExternalLinkAlt />
          </a>，了解如何设置一个示例Lambda@Edge项目。我们的边缘应用将与示例应用有所不同，但值得一读。
        </p>
        <p>
          请注意，我们的边缘应用直接响应 <code>viewer-request</code>，而不转发到源；与CloudFront的交互是最少的（AWS教程中的步骤2）。
        </p>

        <div className="h4 mt-4 mb-3">
          步骤2：实现我们的边缘应用请求处理程序
        </div>
        <p>
          要运行边缘应用，请将我们的基础应用添加到请求处理程序到您的项目中。
        </p>
        <p>
          注意：由于Lambda@Edge的限制，您需要将您的环境变量注入到处理程序中，要么直接注入到您的代码库中，要么在编译时注入。
        </p>
        <Code
          language="javascript"
          code={`
import { handleRequest } from "@growthbook/edge-lambda";

export async function handler(event, ctx, callback) {
  // manually build your environment
  const env = buildEnv();
  // specify additional edge endpoint information
  env.host = "www.mysite.io";
  
  handleRequest(event, callback, env);
}

function buildEnv() {
  return {
    PROXY_TARGET: "https://internal.mysite.io",
    GROWTHBOOK_API_HOST: ${JSON.stringify(apiHost)},
    GROWTHBOOK_CLIENT_KEY: ${JSON.stringify(apiKey)},${encryptionKey
              ? `\n    GROWTHBOOK_DECRYPTION_KEY: ${JSON.stringify(
                encryptionKey
              )},`
              : ""
            }
  };
}
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">进一步定制</div>
        <ul>
          <li>
            设置一个边缘键值存储，如 <strong>DynamoDB</strong>，并使用GrowthBook <strong>SDK网络钩子</strong> 来保持GrowthBook和您的边缘工作者之间的特性和实验值同步。这将消除从边缘到GrowthBook的网络请求。
          </li>
          <li>
            通过设置 <code>{`RUN_URL_REDIRECT_EXPERIMENTS="everywhere"`}</code> 来在边缘启用URL重定向实验（默认关闭）。
          </li>
          <li>
            通过设置 <code>{`ENABLE_STICKY_BUCKETING="true"`}</code> 来在边缘和浏览器中启用基于Cookie的粘性分桶。
          </li>
          <li>
            通过设置 <code>{`ENABLE_STREAMING="true"`}</code> 来在浏览器中启用流模式。
          </li>
          <li>
            为您的浏览器SDK和/或边缘工作者添加自定义跟踪回调。
          </li>
        </ul>
        <p>
          请参阅 <DocLink docSection="lambda">Lambda@Edge文档</DocLink> 以获取更多说明。
        </p>
      </>
    );
  }
  if (language === "edge-other") {
    return (
      <>
        <p>
          我们的 <strong>边缘应用</strong> 在边缘提供了一站式的可视化编辑器和URL重定向实验功能，且不会出现与前端实验相关的闪烁问题。它作为您的应用程序和最终用户之间的智能代理层运行。它还可以将完全加载的前端SDK注入到渲染页面中，这意味着不需要额外的网络请求。
        </p>

        <div className="h4 mt-4 mb-3">
          步骤1：实现我们的边缘应用请求处理程序
        </div>
        <p>
          要运行边缘应用，请将我们的基础应用添加到请求处理程序到您的项目中。您需要手动构建应用上下文和辅助函数：
        </p>
        <Code
          language="javascript"
          code={`
import { edgeApp, getConfig, defaultContext } from "@growthbook/edge-utils";

export async function handler(request, env) {
  const context = await init(env);
  return edgeApp(context, request);
}

function init(env) {
  const context = defaultContext;
  context.config = getConfig(env);
  context.helpers = {
    // define utility functions for request/response manipulation
  };
  return context;
}
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">步骤2：定义辅助方法</div>
        <p>
          您需要定义与您的边缘提供程序处理各种请求和响应工具的方式相对应的辅助方法。例如：读取请求头、创建响应对象、管理Cookie等。
        </p>

        <div className="h4 mt-4 mb-3">步骤3：设置环境变量</div>
        <p>
          至少将以下必填字段添加到您的环境变量中：
        </p>
        <Code
          language="bash"
          code={`
[vars]
PROXY_TARGET="https://internal.mysite.io"  # The non-edge URL to your website
GROWTHBOOK_API_HOST=${JSON.stringify(apiHost)}
GROWTHBOOK_CLIENT_KEY=${JSON.stringify(apiKey)}${encryptionKey
              ? `\nGROWTHBOOK_DECRYPTION_KEY=${JSON.stringify(encryptionKey)}`
              : ""
            }
          `.trim()}
        />

        <div className="h4 mt-4 mb-3">进一步定制</div>
        <ul>
          <li>
            设置一个边缘键值存储，并使用GrowthBook <strong>SDK网络钩子</strong> 来保持GrowthBook和您的边缘工作者之间的特性和实验值同步。这将消除从边缘到GrowthBook的网络请求。
          </li>
          <li>
            通过设置 <code>{`RUN_URL_REDIRECT_EXPERIMENTS="everywise"`}</code> 来在边缘启用URL重定向实验（默认关闭）。
          </li>
          <li>
            通过设置 <code>{`ENABLE_STICKY_BUCKETING="true"`}</code> 来在边缘和浏览器中启用基于Cookie的粘性分桶。
          </li>
          <li>
            通过设置 <code>{`ENABLE_STREAMING="true"`}</code> 来在浏览器中启用流模式。
          </li>
          <li>
            为您的浏览器SDK和/或边缘工作者添加自定义跟踪回调。
          </li>
        </ul>
        <p>
          请参阅 <DocLink docSection="edge">其他边缘文档</DocLink> 以获取更多说明。
        </p>
      </>
    );
  }

  return (
    <p>
      我们目前还没有针对您所用语言的SDK，但如果您想自行构建并回馈给社区，我们有详尽的文档！ <DocLink docSection="buildYourOwn">查看文档</DocLink>
    </p>
  );
}
