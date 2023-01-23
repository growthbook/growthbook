import { SDKLanguage } from "back-end/types/sdk-connection";
import stringify from "json-stringify-pretty-compact";
import { SDKAttributeSchema } from "back-end/types/organization";
import { useAttributeSchema } from "@/services/features";
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

export default function TargetingAttributeCodeSnippet({
  language,
}: {
  language: SDKLanguage;
}) {
  const attributeSchema = useAttributeSchema();
  const exampleAttributes = getExampleAttributes(attributeSchema);

  if (language === "javascript") {
    return (
      <Code
        language="javascript"
        code={`growthbook.setAttributes(${stringify(exampleAttributes)});`}
      />
    );
  }
  if (language === "react") {
    return (
      <Code
        language="tsx"
        code={`growthbook.setAttributes(${stringify(exampleAttributes)});`}
      />
    );
  }
  if (language === "nodejs") {
    return (
      <Code
        language="javascript"
        code={`
app.use(function(req, res, next) {
  req.growthbook.setAttributes(${indentLines(stringify(exampleAttributes), 2)});
  next();
})
`.trim()}
      />
    );
  }
  if (language === "android") {
    return (
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
    );
  }
  if (language === "ios") {
    return (
      <Code
        language="swift"
        code={`
var attrs = ${swiftArrayFormat(exampleAttributes)}
gb.setAttributes(attrs)
    `.trim()}
      />
    );
  }
  if (language === "go") {
    return (
      <Code
        language="go"
        code={`
gb.WithAttributes(growthbook.Attributes${JSON.stringify(
          exampleAttributes,
          null,
          "\t"
        )
          .replace(/null/g, "nil")
          .replace(/\n(\t+)\}/, ",\n$1}")})
            `.trim()}
      />
    );
  }
  if (language === "ruby") {
    return (
      <Code
        language="ruby"
        code={`gb.attributes=${stringify(exampleAttributes).replace(
          /: null/g,
          ": nil"
        )}`}
      />
    );
  }
  if (language === "php") {
    return (
      <Code
        language="php"
        code={`$growthbook->withAttributes(${phpArrayFormat(
          exampleAttributes
        )});`}
      />
    );
  }
  if (language === "python") {
    return (
      <Code
        language="python"
        code={`gb.setAttributes(${stringify(exampleAttributes)
          .replace(/: true/g, ": True")
          .replace(/: false/g, ": False")
          .replace(/: null/g, ": None")})`}
      />
    );
  }
  if (language === "java") {
    return (
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
    );
  }
  if (language === "flutter") {
    return (
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
    );
  }
  if (language === "csharp") {
    return (
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
    );
  }

  return null;
}
