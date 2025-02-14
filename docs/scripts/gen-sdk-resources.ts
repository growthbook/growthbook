import fs from "node:fs";
import path from "node:path";
import { getLatestSDKVersion, getSDKCapabilities } from "shared/sdk-versioning";

const basePath = path.resolve(path.dirname(process.argv[1]), "..");
const TARGET = `${basePath}/src/data/SDKInfo.json`;

const baseSDKInfo = {
  js: {
    name: "JS SDK",
    version: getLatestSDKVersion("javascript"),
    github:
      "https://github.com/growthbook/growthbook/tree/main/packages/sdk-js",
    examples: [
      {
        url:
          "https://github.com/growthbook/examples/tree/main/vanilla-typescript",
        name: "Typescript example app",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/growthbook",
      },
    ],
    capabilities: getSDKCapabilities(
      "javascript",
      getLatestSDKVersion("javascript")
    ),
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
    capabilities: getSDKCapabilities("react", getLatestSDKVersion("react")),
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
    capabilities: getSDKCapabilities("php", getLatestSDKVersion("php")),
  },
  node: {
    name: "Node SDK",
    version: getLatestSDKVersion("nodejs"),
    github:
      "https://github.com/growthbook/growthbook/tree/main/packages/sdk-js",
    examples: [
      {
        url: "http://localhost:3200/guide/express-js",
        name: "Express.js guide",
      },
    ],
    packageRepos: [
      {
        name: "npm module",
        url: "https://www.npmjs.com/package/@growthbook/growthbook",
      },
    ],
    capabilities: getSDKCapabilities("nodejs", getLatestSDKVersion("nodejs")),
  },
  ruby: {
    name: "Ruby SDK",
    version: getLatestSDKVersion("ruby"),
    github: "https://github.com/growthbook/growthbook-ruby",
    examples: [
      {
        url:
          "https://github.com/growthbook/examples/tree/main/acme_donuts_rails",
        name: "Rails example app",
      },
    ],
    packageRepos: [
      {
        name: "RubyGems",
        url: "https://rubygems.org/gems/growthbook",
      },
    ],
    capabilities: getSDKCapabilities("ruby", getLatestSDKVersion("ruby")),
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
    capabilities: getSDKCapabilities("python", getLatestSDKVersion("python")),
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
    capabilities: getSDKCapabilities("go", getLatestSDKVersion("go")),
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
        url:
          "https://github.com/growthbook/examples/tree/main/jvm-kotlin-ktor-example",
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
    capabilities: getSDKCapabilities("java", getLatestSDKVersion("java")),
  },
  csharp: {
    name: "C# SDK",
    version: getLatestSDKVersion("csharp"),
    github: "https://github.com/growthbook/growthbook-c-sharp",
    examples: [
      {
        url:
          "https://github.com/growthbook/examples/tree/main/csharp-example/GrowthBookCSharpExamples",
        name: "C# example app",
      },
    ],
    packageRepos: [
      {
        name: "NuGet",
        url: "https://www.nuget.org/packages/growthbook-c-sharp",
      },
    ],
    capabilities: getSDKCapabilities("csharp", getLatestSDKVersion("csharp")),
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
    capabilities: getSDKCapabilities("elixir", getLatestSDKVersion("elixir")),
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
    capabilities: getSDKCapabilities("android", getLatestSDKVersion("android")),
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
    capabilities: getSDKCapabilities("ios", getLatestSDKVersion("ios")),
  },
  reactNative: {
    name: "React SDK",
    version: getLatestSDKVersion("react"),
    github:
      "https://github.com/growthbook/growthbook/tree/main/packages/sdk-react",
    examples: [
      {
        url:
          "https://github.com/growthbook/examples/tree/main/react-native-cli",
        name: "React Native CLI example app",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/growthbook-react",
      },
    ],
    capabilities: getSDKCapabilities("react", getLatestSDKVersion("react")),
  },
  edgeCloudflare: {
    name: "Cloudflare Edge SDK",
    version: getLatestSDKVersion("edge-cloudflare"),
    github:
      "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-cloudflare",
    examples: [
      {
        url:
          "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-utils",
        name: "Edge Utils",
      },
    ],
    packageRepos: [
      {
        name: "npm",
        url: "https://www.npmjs.com/package/@growthbook/growthbook-proxy",
      },
    ],
    capabilities: getSDKCapabilities(
      "edge-cloudflare",
      getLatestSDKVersion("edge-cloudflare")
    ),
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
    capabilities: getSDKCapabilities("flutter", getLatestSDKVersion("flutter")),
  },
};

fs.writeFileSync(TARGET, JSON.stringify(baseSDKInfo, null, 2));
