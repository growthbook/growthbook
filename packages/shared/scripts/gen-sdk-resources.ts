import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import {
  getLatestSDKVersion,
  getSDKCapabilities,
  getSDKCapabilityVersion,
  SDKCapability,
} from "shared/sdk-versioning";
import type { SDKLanguage } from "shared/types/sdk-connection";

function defineSDKCapabilityVersion(sdk: string, capabilities: string[]) {
  return capabilities.map((c) => {
    const v = getSDKCapabilityVersion(sdk as SDKLanguage, c as SDKCapability);
    return {
      [c]: v === "All versions" ? "All versions" : `≥ v${v}`,
    };
  });
}

const basePath = path.resolve(path.dirname(process.argv[1]), "../../../docs");
const TARGET = `${basePath}/src/data/SDKInfo.ts`;

const defaultCapabilities = [
  { features: "All versions" },
  { experimentation: "All versions" },
];

const baseSDKInfo = {
  js: {
    name: "JS SDK",
    version: getLatestSDKVersion("javascript"),
    github:
      "https://github.com/growthbook/growthbook/tree/main/packages/sdk-js",
    examples: [
      {
        url: "https://github.com/growthbook/examples/tree/main/vanilla-typescript",
        name: "Typescript example app",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/growthbook",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "javascript",
        getSDKCapabilities("javascript", getLatestSDKVersion("javascript")),
      ),
    ],
  },
  react: {
    name: "React SDK",
    version: getLatestSDKVersion("react"),
    github:
      "https://github.com/growthbook/growthbook/tree/main/packages/sdk-react",
    examples: [
      {
        url: "https://github.com/growthbook/examples/tree/main/next-js",
        name: "Next.js example app",
      },
      {
        url: "https://github.com/growthbook/examples/tree/main/next-js-pages",
        name: "Next.js pages example app",
      },
      {
        url: "https://docs.growthbook.io/guide/create-react-app-and-growthbook",
        name: "Create React App guide",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/growthbook-react",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "react",
        getSDKCapabilities("react", getLatestSDKVersion("react")),
      ),
    ],
  },
  nextjs: {
    name: "Next.js SDK",
    version: getLatestSDKVersion("nextjs"),
    github:
      "https://github.com/vercel/flags/tree/main/packages/adapter-growthbook",
    examples: [
      {
        url: "https://github.com/vercel/examples/tree/main/flags-sdk/growthbook",
        name: "Next.js Flags SDK example app",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@flags-sdk/growthbook",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "nextjs",
        getSDKCapabilities("nextjs", getLatestSDKVersion("nextjs")),
      ),
    ],
  },
  php: {
    name: "PHP SDK",
    version: getLatestSDKVersion("php"),
    github: "https://github.com/growthbook/growthbook-php",
    examples: [],
    packageRepos: [
      {
        name: "Packagist (Composer)",
        url: "https://packagist.org/packages/growthbook/growthbook",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "php",
        getSDKCapabilities("php", getLatestSDKVersion("php")),
      ),
    ],
  },
  node: {
    name: "Node SDK",
    version: getLatestSDKVersion("nodejs"),
    github:
      "https://github.com/growthbook/growthbook/tree/main/packages/sdk-js",
    examples: [
      {
        url: "https://docs.growthbook.io/guide/express-js",
        name: "Express.js guide",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/growthbook",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "nodejs",
        getSDKCapabilities("nodejs", getLatestSDKVersion("nodejs")),
      ),
    ],
  },
  ruby: {
    name: "Ruby SDK",
    version: getLatestSDKVersion("ruby"),
    github: "https://github.com/growthbook/growthbook-ruby",
    examples: [
      {
        url: "https://github.com/growthbook/examples/tree/main/acme_donuts_rails",
        name: "Rails example app",
      },
    ],
    packageRepos: [
      {
        name: "RubyGems",
        url: "https://rubygems.org/gems/growthbook",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "ruby",
        getSDKCapabilities("ruby", getLatestSDKVersion("ruby")),
      ),
    ],
  },
  python: {
    name: "Python SDK",
    version: getLatestSDKVersion("python"),
    github: "https://github.com/growthbook/growthbook-python",
    examples: [],
    packageRepos: [
      {
        name: "PyPi",
        url: "https://pypi.org/project/growthbook/",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "python",
        getSDKCapabilities("python", getLatestSDKVersion("python")),
      ),
    ],
  },
  go: {
    name: "Go SDK",
    version: getLatestSDKVersion("go"),
    github: "https://github.com/growthbook/growthbook-golang",
    examples: [
      {
        url: "https://github.com/growthbook/examples/tree/main/go-example",
        name: "Go example app",
      },
    ],
    packageRepos: [
      {
        name: "Go Modules",
        url: "https://pkg.go.dev/github.com/growthbook/growthbook-golang",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "go",
        getSDKCapabilities("go", getLatestSDKVersion("go")),
      ),
    ],
  },
  rust: {
    name: "Rust SDK",
    version: "0.0.3",
    github: "https://github.com/growthbook/growthbook-rust",
    examples: [
      {
        url: "https://github.com/growthbook/growthbook-rust/tree/main/examples/client",
        name: "Rust example app",
      },
    ],
    packageRepos: [
      {
        name: "crates.io",
        url: "https://crates.io/crates/growthbook-rust",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "rust",
        getSDKCapabilities("rust", getLatestSDKVersion("rust")),
      ),
    ],
  },
  java: {
    name: "Java SDK",
    version: getLatestSDKVersion("java"),
    github: "https://github.com/growthbook/growthbook-sdk-java",
    examples: [
      {
        url: "https://github.com/growthbook/examples/tree/main/jvm-spring-web",
        name: "JVM with Spring Web example app",
      },
      {
        url: "https://github.com/growthbook/examples/tree/main/jvm-kotlin-ktor-example",
        name: "JVM with Kotlin Ktor example app",
      },
      {
        url: "https://github.com/growthbook/examples/tree/main/android-example",
        name: "Android example app",
      },
      {
        url: "https://growthbook.github.io/growthbook-sdk-java/",
        name: "JavaDoc class docs",
      },
    ],
    packageRepos: [
      {
        name: "JitPack",
        url: "https://jitpack.io/#growthbook/growthbook-sdk-java",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "java",
        getSDKCapabilities("java", getLatestSDKVersion("java")),
      ),
    ],
  },
  csharp: {
    name: "C# SDK",
    version: getLatestSDKVersion("csharp"),
    github: "https://github.com/growthbook/growthbook-c-sharp",
    examples: [
      {
        url: "https://github.com/growthbook/examples/tree/main/csharp-example/GrowthBookCSharpExamples",
        name: "C# example app",
      },
    ],
    packageRepos: [
      {
        name: "NuGet",
        url: "https://www.nuget.org/packages/growthbook-c-sharp",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "csharp",
        getSDKCapabilities("csharp", getLatestSDKVersion("csharp")),
      ),
    ],
  },
  elixir: {
    name: "Elixir SDK",
    version: getLatestSDKVersion("elixir"),
    github: "https://github.com/growthbook/growthbook-elixir",
    examples: [],
    packageRepos: [
      {
        name: "Hex",
        url: "https://www.hex.pm/packages/growthbook",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "elixir",
        getSDKCapabilities("elixir", getLatestSDKVersion("elixir")),
      ),
    ],
  },
  kotlin: {
    name: "Kotlin SDK",
    version: getLatestSDKVersion("android"),
    github: "https://github.com/growthbook/growthbook-kotlin",
    examples: [],
    packageRepos: [
      {
        name: "Maven Central",
        url: "https://mvnrepository.com/artifact/io.growthbook.sdk/GrowthBook",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "android",
        getSDKCapabilities("android", getLatestSDKVersion("android")),
      ),
    ],
  },
  swift: {
    name: "Swift SDK",
    version: getLatestSDKVersion("ios"),
    github: "https://github.com/growthbook/growthbook-swift",
    examples: [],
    packageRepos: [
      {
        name: "Swift Package Manager (SPM)",
        url: "https://swiftpackageindex.com/growthbook/growthbook-swift",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "ios",
        getSDKCapabilities("ios", getLatestSDKVersion("ios")),
      ),
    ],
  },
  reactNative: {
    name: "React Native SDK",
    version: getLatestSDKVersion("react"),
    github:
      "https://github.com/growthbook/growthbook/tree/main/packages/sdk-react",
    examples: [
      {
        url: "https://github.com/growthbook/examples/tree/main/react-native-cli",
        name: "React Native CLI example app",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/growthbook-react",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "react",
        getSDKCapabilities("react", getLatestSDKVersion("react")),
      ),
    ],
  },
  edgeCloudflare: {
    name: "Cloudflare Workers App & SDK",
    version: getLatestSDKVersion("edge-cloudflare"),
    github:
      "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-cloudflare",
    examples: [
      {
        url: "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-cloudflare/example",
        name: "Example worker",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/edge-cloudflare",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "edge-cloudflare",
        getSDKCapabilities(
          "edge-cloudflare",
          getLatestSDKVersion("edge-cloudflare"),
        ),
      ),
    ],
  },
  edgeFastly: {
    name: "Fastly Compute App & SDK",
    version: getLatestSDKVersion("edge-fastly"),
    github:
      "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-fastly",
    examples: [
      {
        url: "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-fastly/example",
        name: "Example compute worker",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/edge-fastly",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "edge-fastly",
        getSDKCapabilities("edge-fastly", getLatestSDKVersion("edge-fastly")),
      ),
    ],
  },
  edgeLambda: {
    name: "Lambda@Edge App & SDK",
    version: getLatestSDKVersion("edge-lambda"),
    github:
      "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-lambda",
    examples: [],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/edge-lambda",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "edge-lambda",
        getSDKCapabilities("edge-lambda", getLatestSDKVersion("edge-lambda")),
      ),
    ],
  },
  edgeUtils: {
    name: "Edge Utils",
    version: "0.2.5",
    github:
      "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-utils",
    examples: [],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/edge-utils",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "edge-other",
        getSDKCapabilities("edge-other", getLatestSDKVersion("edge-other")),
      ),
    ],
  },
  flutter: {
    name: "Flutter SDK",
    version: getLatestSDKVersion("flutter"),
    github: "https://github.com/growthbook/growthbook-flutter",
    examples: [],
    packageRepos: [
      {
        name: "pub.dev",
        url: "https://pub.dev/packages/growthbook_sdk_flutter",
      },
    ],
    capabilities: [
      ...defaultCapabilities,
      ...defineSDKCapabilityVersion(
        "flutter",
        getSDKCapabilities("flutter", getLatestSDKVersion("flutter")),
      ),
    ],
  },
};

const content = `// THIS FILE IS AUTOGENERATED BY \`pnpm gen-sdk-resources\`. DO NOT EDIT DIRECTLY.\n\nexport default ${JSON.stringify(
  baseSDKInfo,
  null,
  2,
)}`;

async function formatAndSaveFile(content: string, target: string) {
  const formattedSDKInfo = await prettier.format(content, {
    parser: "typescript",
  });
  fs.writeFileSync(target, formattedSDKInfo);
}

formatAndSaveFile(content, TARGET);
