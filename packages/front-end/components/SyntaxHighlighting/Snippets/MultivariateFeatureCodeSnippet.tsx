import { FeatureValueType } from "shared/types/feature";
import { SDKLanguage } from "shared/types/sdk-connection";
import Code from "@/components/SyntaxHighlighting/Code";

function rubySymbol(name: string): string {
  return name.match(/[^a-zA-Z0-9_]+/) ? `'${name}'` : `:${name}`;
}

function javaType(type: FeatureValueType): string {
  if (type === "boolean") return "Boolean";
  if (type === "number") return "Float";
  if (type === "string") return "String";
  return "Object";
}

function javaDefaultValue(type: FeatureValueType) {
  if (type === "boolean") return "true";
  if (type === "number") return "1.0f";
  if (type === "string") return '"fallback"';
  return "new Object()";
}

function getDefaultValue(type: FeatureValueType, emptyObj: string = "{}") {
  if (type === "number") return "0.0";
  if (type === "string") return '"fallback"';
  return emptyObj;
}

export default function MultivariateFeatureCodeSnippet({
  language,
  featureId = "myfeature",
  valueType = "string",
}: {
  language: SDKLanguage;
  featureId?: string;
  valueType?: FeatureValueType;
}) {
  if (language.match(/^nocode/)) {
    return (
      <Code
        language="html"
        code={`
<script>
const value = window._growthbook?.getFeatureValue(
  ${JSON.stringify(featureId)},
  ${getDefaultValue(valueType)}
);
console.log(value);
</script>
`.trim()}
      />
    );
  }
  if (language === "javascript") {
    return (
      <Code
        language="javascript"
        code={`
const value = growthbook.getFeatureValue(
  ${JSON.stringify(featureId)},
  ${getDefaultValue(valueType)}
);
console.log(value);
`.trim()}
      />
    );
  }
  if (language === "react") {
    return (
      <Code
        language="tsx"
        code={`
import { useFeatureValue } from "@growthbook/growthbook-react";

function MyComponent() {
  const value = useFeatureValue(${JSON.stringify(featureId)}, ${getDefaultValue(
    valueType,
  )});
  return (
    <div>{value}</div>
  )
}
`.trim()}
      />
    );
  }
  if (language === "nodejs") {
    return (
      <Code
        language="javascript"
        code={`
app.get("/", (req, res) => {
  const value = req.growthbook.getFeatureValue(
    ${JSON.stringify(featureId)},
    ${getDefaultValue(valueType)}
  );
  
  res.send("The feature value is: " + value);
});
`.trim()}
      />
    );
  }
  if (language === "nextjs") {
    const typeString = valueType === "json" ? "Record<string, any>" : valueType;
    return (
      <>
        <div className="font-weight-bold text-muted mt-2">
          Define your feature flag
        </div>
        <Code
          filename="flags.ts"
          language="typescript"
          code={`
import { growthbookAdapter } from '@flags-sdk/growthbook';
import { flag } from 'flags/next';
import { identify } from '@/lib/identify';

export const myFeatureFlag = flag<${typeString}>({
  key: ${JSON.stringify(featureId)},
  adapter: growthbookAdapter.feature<${typeString}>(),
  defaultValue: ${getDefaultValue(valueType)},
  identify,
});
`.trim()}
        />

        <div className="font-weight-bold text-muted mt-2">Use the flag</div>
        <Code
          filename="my-component.tsx"
          language="tsx"
          code={`
import { myFeatureFlag } from '@/flags';

function MyComponent() {
  const value = await myFeatureFlag();
  // value is: ${getDefaultValue(valueType)}

  return (
    <div>{${valueType === "json" ? "JSON.stringify(value)" : "value"}}</div>
  );
}
  `.trim()}
        />
      </>
    );
  }
  if (language === "android") {
    return (
      <Code
        language="kotlin"
        code={`
val feature = gb.feature(${JSON.stringify(featureId)})
println(feature.value ?: ${getDefaultValue(valueType)})
`.trim()}
      />
    );
  }
  if (language === "ios") {
    return (
      <Code
        language="swift"
        code={`
var value = gb.getFeatureValue(${JSON.stringify(featureId)}, ${getDefaultValue(
          valueType,
        )})
print(value)
    `.trim()}
      />
    );
  }
  if (language === "go") {
    return (
      <Code
        language="go"
        code={`
value := client.EvalFeature(context.Background(), ${JSON.stringify(
          featureId,
        )}).Value
fmt.Println(value)
            `.trim()}
      />
    );
  }
  if (language === "ruby") {
    return (
      <Code
        language="ruby"
        code={`
value = gb.feature_value(${rubySymbol(featureId)}, ${getDefaultValue(
          valueType,
        )})
puts(value)
            `.trim()}
      />
    );
  }
  if (language === "php") {
    return (
      <Code
        language="php"
        code={`
$value = $growthbook->getValue(${JSON.stringify(featureId)}, ${getDefaultValue(
          valueType,
          "[]",
        )});
echo $value;
            `.trim()}
      />
    );
  }
  if (language === "python") {
    return (
      <Code
        language="python"
        code={`
value = gb.get_feature_value(${JSON.stringify(featureId)}, ${getDefaultValue(
          valueType,
        )})
print(value)
            `.trim()}
      />
    );
  }
  if (language === "java") {
    return (
      <Code
        language="java"
        code={`
${javaType(valueType)} value = growthBook.getFeatureValue(${JSON.stringify(
          featureId,
        )}, ${javaDefaultValue(valueType)});
            `.trim()}
      />
    );
  }
  if (language === "flutter") {
    return (
      <Code
        language="dart"
        code={`
GBFeatureResult feature = gb.feature(${JSON.stringify(featureId)})
Println(feature.value)
`.trim()}
      />
    );
  }
  if (language === "csharp") {
    return (
      <Code
        language="csharp"
        code={`
var value = gb.GetFeatureValue<string>(${JSON.stringify(
          featureId,
        )}, ${getDefaultValue(valueType)});
Console.WriteLine(value);
    `.trim()}
      />
    );
  }
  if (language === "elixir") {
    return (
      <Code
        language="elixir"
        code={`
feature = GrowthBook.feature(context, ${JSON.stringify(featureId)})
IO.inspect(feature.value)
    `.trim()}
      />
    );
  }
  if (language === "edge-cloudflare") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  return new Response("<h1>foo</h1>");
}
return new Response("<h1>bar</h1>");
        `.trim()}
      />
    );
  }
  if (language === "edge-fastly") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  return new Response("<h1>foo</h1>");
}
return new Response("<h1>bar</h1>");
        `.trim()}
      />
    );
  }
  if (language === "edge-lambda") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  const resp = { status: "200", body: "<h1>foo</h1>" };
  callback(null, resp);
} else {
  const resp = { status: "200", body: "<h1>bar</h1>" };
  callback(null, resp);
}
        `.trim()}
      />
    );
  }
  if (language === "edge-other") {
    return (
      <Code
        language="javascript"
        code={`
if (growthbook.isOn("my-feature")) {
  return new Response("<h1>foo</h1>");
}
return new Response("<h1>bar</h1>");
        `.trim()}
      />
    );
  }

  return <em>Depends on your platform</em>;
}
