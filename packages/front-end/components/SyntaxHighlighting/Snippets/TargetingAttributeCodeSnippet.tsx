import { createHash } from "crypto";
import { SDKLanguage } from "back-end/types/sdk-connection";
import stringify from "json-stringify-pretty-compact";
import { SDKAttributeSchema } from "back-end/types/organization";
import { paddedVersionString } from "@growthbook/growthbook";
import { Box, Flex } from "@radix-ui/themes";
import { useAttributeSchema } from "@/services/features";
import Code from "@/components/SyntaxHighlighting/Code";
import { pluginSupportedTrackers } from "@/components/SyntaxHighlighting/Snippets/EventTrackerSelector";
import { DocLink } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";

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

function replaceAttributeValues(
  attributesStr: string,
  values: Record<string, string>
) {
  Object.entries(values).forEach(([key, value]) => {
    attributesStr = attributesStr.replace(
      new RegExp(`"${key}": [^\n,]+`, "g"),
      `"${key}": ${value}`
    );
  });
  return attributesStr;
}

function getExampleAttributes({
  attributeSchema,
  hashSecureAttributes = false,
  secureAttributeSalt = "",
}: {
  attributeSchema?: SDKAttributeSchema;
  hashSecureAttributes?: boolean;
  secureAttributeSalt?: string;
}) {
  if (!attributeSchema?.length) return {};

  // eslint-disable-next-line
  const exampleAttributes: any = {};
  attributeSchema.forEach(({ property, datatype, enum: enumList }) => {
    const parts = property.split(".");
    const last = parts.pop() || "";
    let current = exampleAttributes;
    for (let i = 0; i < parts.length; i++) {
      current[parts[i]] = current[parts[i]] || {};
      current = current[parts[i]];
    }

    let value: unknown = null;
    if (datatype === "boolean") {
      value = true;
    } else if (datatype === "number") {
      value = 123;
    } else if (datatype === "string") {
      value = "foo";
    } else if (datatype === "secureString") {
      value = hashSecureAttributes ? sha256("foo", secureAttributeSalt) : "foo";
    } else if (datatype === "number[]") {
      value = [1, 2, 3];
    } else if (datatype === "string[]") {
      value = ["foo", "bar"];
    } else if (datatype === "secureString[]") {
      value = hashSecureAttributes
        ? ["foo", "bar"].map((v) => sha256(v, secureAttributeSalt))
        : ["foo", "bar"];
    } else if (datatype === "enum") {
      value = enumList?.split(",").map((v) => v.trim())[0] ?? null;
    }

    current[last] = value;
  });

  return exampleAttributes;
}

export default function TargetingAttributeCodeSnippet({
  language,
  hashSecureAttributes = false,
  secureAttributeSalt = "",
  version,
  eventTracker,
  apiHost,
  apiKey,
}: {
  language: SDKLanguage;
  hashSecureAttributes?: boolean;
  secureAttributeSalt?: string;
  version?: string;
  eventTracker?: string;
  apiHost: string;
  apiKey: string;
}) {
  let introText =
    "Replace the placeholders with your real targeting attribute values. This enables you to target feature flags based on user attributes.";
  const introElements: JSX.Element[] = [];

  const attributeSchema = useAttributeSchema();
  const exampleAttributes = getExampleAttributes({
    attributeSchema,
    hashSecureAttributes,
    secureAttributeSalt,
  });

  const attributesSnippets: JSX.Element[] = [];

  const usePlugins =
    paddedVersionString(version) >= paddedVersionString("1.3.0");

  if (
    usePlugins &&
    pluginSupportedTrackers.includes(eventTracker ?? "") &&
    language === "javascript"
  ) {
    introText =
      "Or, you can define attributes manually. Replace the placeholders with your real targeting attribute values. This enables you to target feature flags based on user attributes.";
    introElements.unshift(
      <>
        <p>
          You can use GrowthBook&apos;s plugins to automatically set some
          targeting attributes{" "}
          <Tooltip
            body={
              <>
                <p>The following attributes will be set by the plugin:</p>
                <ul>
                  <li>
                    <strong>id</strong>
                  </li>
                  <li>
                    <strong>url</strong>
                  </li>
                  <li>
                    <strong>path</strong>
                  </li>
                  <li>
                    <strong>host</strong>
                  </li>
                  <li>
                    <strong>query</strong>
                  </li>
                  <li>
                    <strong>deviceType</strong>
                  </li>
                  <li>
                    <strong>browser</strong>
                  </li>
                  <li>
                    <strong>utmSource</strong>
                  </li>
                  <li>
                    <strong>utmMedium</strong>
                  </li>
                  <li>
                    <strong>utmCampaign</strong>
                  </li>
                  <li>
                    <strong>utmTerm</strong>
                  </li>
                  <li>
                    <strong>utmContent</strong>
                  </li>
                </ul>
              </>
            }
          />
          <br />
          Read more about this{" "}
          <DocLink docSection="javascriptAutoAttributes">here</DocLink>.
        </p>
        <Code
          language="javascript"
          code={`
import { autoAttributesPlugin } from "@growthbook/growthbook/plugins";

const gb = new GrowthBook({
  apiHost: ${JSON.stringify(apiHost)},
  clientKey: ${JSON.stringify(apiKey)},
  plugins: [
    autoAttributesPlugin({}),
  ],
});
`.trim()}
        />
      </>
    );
  }

  const extraInfoAfter: JSX.Element[] = [];

  // if the language has an event tracker dropdown (ie: javascript) and may require additional config to get the ID, we show the additional steps required.
  if (language === "javascript") {
    if (eventTracker === "mixpanel") {
      extraInfoAfter.push(
        <Box>
          If you want to use Mixpanel&apos;s distinct ID for assignment you need
          to pass this id to GrowthBook. This might need to be adjusted to wait
          for Mixpanel to load.
          <Code
            language="javascript"
            code={`
// Add the mixpanel user id to the GrowthBook attributes when it loads:
mixpanel.init("[YOUR PROJECT TOKEN]", {
  debug: true,
  loaded: function (mx) {
    growthbook.setAttributes({
      ...growthbook.getAttributes(),
      id: mx.get_distinct_id(),
    });
  },
});  
`.trim()}
          />
        </Box>
      );
    } else if (eventTracker === "rudderstack") {
      extraInfoAfter.push(
        <Box>
          If you want to use RudderStack&apos;s id for assignment (recommended)
          the ID needs to be passed to GrowthBook. This may need to be adjusted
          to match your naming.
          <Code
            language="javascript"
            code={`// Add in Rudderstack anonId when loaded
rudderstack.getAnonymousId().then((id) => {
  growthbook.setAttributes({ ...growthbook.getAttributes(), id });
});`.trim()}
          />
        </Box>
      );
    } else if (eventTracker === "snowplow") {
      extraInfoAfter.push(
        <Box>
          Snowplow requires an addition step to add the ID attribute from
          Snowplow
          <Code
            language="javascript"
            code={`// Add in Snowplow domainId when loaded
window.snowplow(function() {
  var sp = this.sp;
  var domainUserId = sp.getDomainUserId();
  growthbook.setAttributes({
    ...growthbook.getAttributes(),
    id: domainUserId,
  });
});`.trim()}
          />
        </Box>
      );
    } else if (eventTracker === "matomo") {
      extraInfoAfter.push(
        <Box>
          If you want to use Matomo&apos;s visitor ID for assignment
          (recommended) you need to pass in this ID to GrowthBook.
          <Code
            language="javascript"
            code={`// add the Matomo anonId when loaded
let visitor_id;
if ("_paq" in window) {
  _paq.push([
    function () {
      visitor_id = this.getVisitorId();
      growthbook.setAttributes({
        ...growthbook.getAttributes(),
        id: visitor_id,
      });
    },
  ]);
}`.trim()}
          />
        </Box>
      );
    } else if (eventTracker === "amplitude") {
      extraInfoAfter.push(
        <Box>
          If you would like to use Amplitude&apos;s device ID for assignment
          (recommended), the ID needs to be passed to GrowthBook. This might
          need to be adjusted to wait for Amplitude to load.
          <Code
            language="javascript"
            code={`// Add the Amplitude user id to the GrowthBook attributes when it loads:
const ampDeviceId = amplitude.getInstance().getDeviceId();
growthbook.setAttributes({ ...growthbook.getAttributes(), id: ampDeviceId });`.trim()}
          />
        </Box>
      );
    }
  }

  // Start of the Language Specific Snippets

  if (language.match(/^nocode/)) {
    const defaultAttributes = [
      "id",
      "url",
      "path",
      "host",
      "query",
      "deviceType",
      "browser",
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmTerm",
      "utmContent",
    ];
    const additionalAttributes = Object.entries(exampleAttributes).filter(
      ([k]) => !defaultAttributes.includes(k)
    );

    if (additionalAttributes.length) {
      attributesSnippets.push(
        <>
          <p>
            Some attributes are set automatically, but you will need to manually
            set the following ones. This must be added BEFORE the GrowthBook
            snippet.
          </p>
          <Code
            language="html"
            code={`
<script>
window.growthbook_config = window.growthbook_config || {};
window.growthbook_config.attributes = ${stringify(
              Object.fromEntries(additionalAttributes)
            )};
</script>
          `.trim()}
          />
        </>
      );
    } else {
      attributesSnippets.push(
        <>
          <div>
            All of your attributes are set automatically, no configuration
            required.
          </div>
        </>
      );
    }
  }

  if (language === "javascript") {
    attributesSnippets.push(
      <>
        <Code
          language="javascript"
          code={`growthbook.setAttributes(${stringify(exampleAttributes)});`}
        />
      </>
    );
  }
  if (language === "react") {
    attributesSnippets.push(
      <>
        <Code
          language="tsx"
          code={`growthbook.setAttributes(${stringify(exampleAttributes)});`}
        />
      </>
    );
  }
  if (language === "nodejs") {
    const useMultiUser =
      paddedVersionString(version) >= paddedVersionString("1.3.1");

    const attributes = replaceAttributeValues(stringify(exampleAttributes), {
      id: "req.user.id",
      email: "req.user.email",
      url: "req.originalUrl",
      path: "req.path",
      host: "req.hostname",
      query: "req.query",
    });

    if (useMultiUser) {
      attributesSnippets.push(
        <>
          <Code
            language="javascript"
            code={`
app.use((req, res, next) => {
  const userContext = {
    attributes: ${indentLines(attributes, 4)}
  }
  
  req.growthbook = client.createScopedInstance(userContext);
});
          `.trim()}
          />
        </>
      );
    } else {
      attributesSnippets.push(
        <>
          <Code
            language="javascript"
            code={`
app.use(function(req, res, next) {
  req.growthbook.setAttributes(${indentLines(stringify(exampleAttributes), 2)});
  next();
})
`.trim()}
          />
        </>
      );
    }
  }
  if (language === "android") {
    attributesSnippets.push(
      <>
        <Code
          language="kotlin"
          code={`
val attrs = HashMap<String, Any>()
${Object.keys(exampleAttributes)
  .map((k) => {
    return `attrs.put("${k}", ${JSON.stringify(exampleAttributes[k])})`;
  })
  .join("\n")}

gb.setAttributes(attrs)
`.trim()}
        />
      </>
    );
  }
  if (language === "ios") {
    attributesSnippets.push(
      <>
        <Code
          language="swift"
          code={`
var attrs = ${swiftArrayFormat(exampleAttributes)}
gb.setAttributes(attrs)
    `.trim()}
        />
      </>
    );
  }
  if (language === "go") {
    attributesSnippets.push(
      <>
        <Code
          language="go"
          code={`
data := []byte(\`${JSON.stringify(exampleAttributes, null, " ")}\`)
var jsonMap map[string]any
if err := json.Unmarshal(data, &jsonMap); err != nil {
  log.Fatal("Invalid JSON")
}
client,err := client.WithAttributes(gb.Attributes(jsonMap))
        `.trim()}
        />
      </>
    );
  }
  if (language === "ruby") {
    attributesSnippets.push(
      <>
        <Code
          language="ruby"
          code={`gb.attributes=${stringify(exampleAttributes).replace(
            /: null/g,
            ": nil"
          )}`}
        />
      </>
    );
  }
  if (language === "php") {
    attributesSnippets.push(
      <>
        <Code
          language="php"
          code={`$growthbook->withAttributes(${phpArrayFormat(
            exampleAttributes
          )});`}
        />
      </>
    );
  }
  if (language === "python") {
    attributesSnippets.push(
      <>
        <Code
          language="python"
          code={`gb.set_attributes(${stringify(exampleAttributes)
            .replace(/: true/g, ": True")
            .replace(/: false/g, ": False")
            .replace(/: null/g, ": None")})`}
        />
      </>
    );
  }
  if (language === "java") {
    attributesSnippets.push(
      <>
        <Code
          language="java"
          code={`
JSONObject userAttributesObj = new JSONObject();
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `userAttributesObj.put(${JSON.stringify(key)}, ${JSON.stringify(
      value
    )});`;
  })
  .join("\n")}
String userAttributesJson = userAttributesObj.toString();
growthBook.setAttributes(userAttributesJson);
            `.trim()}
        />
      </>
    );
  }
  if (language === "flutter") {
    attributesSnippets.push(
      <>
        <Code
          language="dart"
          code={`
val attrs = HashMap<String, Any>()
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `attrs.put(${JSON.stringify(key)}, ${JSON.stringify(value)})`;
  })
  .join("\n")}
gb.setAttributes(attrs);
`.trim()}
        />
      </>
    );
  }
  if (language === "csharp") {
    attributesSnippets.push(
      <>
        <Code
          language="csharp"
          code={`
var attrs = new JObject();
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `attrs.Add(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
  })
  .join("\n")}
gb.SetAttributes(attrs);
    `.trim()}
        />
      </>
    );
  }
  if (language === "elixir") {
    attributesSnippets.push(
      <>
        <Code
          language="elixir"
          code={`
attrs = %{
${Object.entries(exampleAttributes)
  .map(([key, value]) => {
    return `  ${JSON.stringify(key)} => ${JSON.stringify(value)}`;
  })
  .join(",\n")}
}

context = %GrowthBook.Context{
  features: features,
  attributes: attrs
}
          `.trim()}
        />
      </>
    );
  }

  introElements.push(<Box>{introText}</Box>);
  attributesSnippets.unshift(...introElements);
  attributesSnippets.push(...extraInfoAfter);
  return (
    <Flex direction="column" width="100%" gap="3">
      {attributesSnippets.map((snippet, index) => (
        <Box key={index}>{snippet}</Box>
      ))}
    </Flex>
  );
}

function sha256(str: string, salt: string): string {
  return createHash("sha256")
    .update(salt + str)
    .digest("hex");
}
