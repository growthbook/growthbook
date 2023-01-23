import { FeatureValueType } from "back-end/types/feature";
import { SDKLanguage } from "back-end/types/sdk-connection";
import Code from "../Code";

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
          valueType
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
          valueType
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
value := gb.Feature(${JSON.stringify(
          featureId
        )}).GetValueWithDefault(${getDefaultValue(valueType)})
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
          valueType
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
          "[]"
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
value = gb.getFeatureValue(${JSON.stringify(featureId)}, ${getDefaultValue(
          valueType
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
          featureId
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
          featureId
        )}, ${getDefaultValue(valueType)});
Console.WriteLine(value);
    `.trim()}
      />
    );
  }

  return <em>Depends on your platform</em>;
}
