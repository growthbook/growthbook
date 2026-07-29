export const SdkSupportedFeatures = ({ sdk }) => {
  const sdkInfo = {
    js: {
      name: "JS SDK",
      version: "1.6.5",
      github: "https://github.com/growthbook/growthbook/tree/main/packages/sdk-js",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveMembership: "≥ v1.6.4",
        },
        {
          caseInsensitiveRegex: "≥ v1.6.3",
        },
        {
          savedGroupReferences: "≥ v1.1.0",
        },
        {
          redirects: "≥ v0.36.0",
        },
        {
          prerequisites: "≥ v0.34.0",
        },
        {
          stickyBucketing: "≥ v0.32.0",
        },
        {
          visualEditorDragDrop: "≥ v0.30.0",
        },
        {
          remoteEval: "≥ v0.29.0",
        },
        {
          semverTargeting: "≥ v0.27.0",
        },
        {
          visualEditorJS: "≥ v0.27.0",
        },
        {
          visualEditor: "≥ v0.24.0",
        },
        {
          bucketingV2: "≥ v0.23.0",
        },
        {
          streaming: "≥ v0.21.0",
        },
        {
          encryption: "≥ v0.20.0",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    react: {
      name: "React SDK",
      version: "1.6.5",
      github: "https://github.com/growthbook/growthbook/tree/main/packages/sdk-react",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveMembership: "≥ v1.6.4",
        },
        {
          caseInsensitiveRegex: "≥ v1.6.3",
        },
        {
          savedGroupReferences: "≥ v1.1.0",
        },
        {
          redirects: "≥ v0.26.0",
        },
        {
          prerequisites: "≥ v0.24.0",
        },
        {
          stickyBucketing: "≥ v0.22.0",
        },
        {
          visualEditorDragDrop: "≥ v0.20.0",
        },
        {
          remoteEval: "≥ v0.19.0",
        },
        {
          semverTargeting: "≥ v0.17.0",
        },
        {
          visualEditorJS: "≥ v0.17.0",
        },
        {
          visualEditor: "≥ v0.14.0",
        },
        {
          bucketingV2: "≥ v0.13.0",
        },
        {
          streaming: "≥ v0.11.0",
        },
        {
          encryption: "≥ v0.10.1",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    nextjs: {
      name: "Next.js SDK",
      version: "0.1.0",
      github: "https://github.com/vercel/flags/tree/main/packages/adapter-growthbook",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          savedGroupReferences: "≥ v0.1.0",
        },
        {
          redirects: "≥ v0.1.0",
        },
        {
          prerequisites: "≥ v0.1.0",
        },
        {
          stickyBucketing: "≥ v0.1.0",
        },
        {
          semverTargeting: "≥ v0.1.0",
        },
        {
          bucketingV2: "≥ v0.1.0",
        },
        {
          encryption: "≥ v0.1.0",
        },
        {
          looseUnmarshalling: "≥ v0.1.0",
        },
        {
          namespacesV2: "≥ v0.1.0",
        },
      ],
    },
    php: {
      name: "PHP SDK",
      version: "1.7.0",
      github: "https://github.com/growthbook/growthbook-php",
      examples: [],
      packageRepos: [
        {
          name: "Packagist (Composer)",
          url: "https://packagist.org/packages/growthbook/growthbook",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          savedGroupReferences: "≥ v1.7.0",
        },
        {
          prerequisites: "≥ v1.6.0",
        },
        {
          stickyBucketing: "≥ v1.6.0",
        },
        {
          semverTargeting: "≥ v1.5.0",
        },
        {
          bucketingV2: "≥ v1.2.0",
        },
        {
          encryption: "≥ v1.2.0",
        },
        {
          looseUnmarshalling: "≥ v1.0.0",
        },
        {
          namespacesV2: "≥ v1.0.0",
        },
      ],
    },
    node: {
      name: "Node SDK",
      version: "1.6.5",
      github: "https://github.com/growthbook/growthbook/tree/main/packages/sdk-js",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveMembership: "≥ v1.6.4",
        },
        {
          caseInsensitiveRegex: "≥ v1.6.3",
        },
        {
          savedGroupReferences: "≥ v1.1.0",
        },
        {
          redirects: "≥ v0.36.0",
        },
        {
          prerequisites: "≥ v0.34.0",
        },
        {
          stickyBucketing: "≥ v0.32.0",
        },
        {
          semverTargeting: "≥ v0.27.0",
        },
        {
          bucketingV2: "≥ v0.23.0",
        },
        {
          streaming: "≥ v0.21.0",
        },
        {
          encryption: "≥ v0.20.0",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    ruby: {
      name: "Ruby SDK",
      version: "1.3.0",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          prerequisites: "≥ v1.3.0",
        },
        {
          stickyBucketing: "≥ v1.3.0",
        },
        {
          semverTargeting: "≥ v1.2.2",
        },
        {
          encryption: "≥ v1.1.0",
        },
        {
          bucketingV2: "≥ v1.0.0",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    python: {
      name: "Python SDK",
      version: "2.1.1",
      github: "https://github.com/growthbook/growthbook-python",
      examples: [],
      packageRepos: [
        {
          name: "PyPi",
          url: "https://pypi.org/project/growthbook/",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveMembership: "≥ v2.1.1",
        },
        {
          caseInsensitiveRegex: "≥ v2.1.0",
        },
        {
          savedGroupReferences: "≥ v1.2.1",
        },
        {
          looseUnmarshalling: "≥ v1.1.0",
        },
        {
          namespacesV2: "≥ v1.1.0",
        },
        {
          prerequisites: "≥ v1.1.0",
        },
        {
          stickyBucketing: "≥ v1.1.0",
        },
        {
          semverTargeting: "≥ v1.1.0",
        },
        {
          bucketingV2: "≥ v1.0.0",
        },
        {
          encryption: "≥ v1.0.0",
        },
      ],
    },
    go: {
      name: "Go SDK",
      version: "0.2.8",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveMembership: "≥ v0.2.7",
        },
        {
          caseInsensitiveRegex: "≥ v0.2.7",
        },
        {
          stickyBucketing: "≥ v0.2.3",
        },
        {
          prerequisites: "≥ v0.2.0",
        },
        {
          savedGroupReferences: "≥ v0.2.0",
        },
        {
          bucketingV2: "≥ v0.1.4",
        },
        {
          streaming: "≥ v0.1.4",
        },
        {
          semverTargeting: "≥ v0.1.4",
        },
        {
          encryption: "≥ v0.1.4",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    rust: {
      name: "Rust SDK",
      version: "0.1.1",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveRegex: "≥ v0.1.1",
        },
        {
          caseInsensitiveMembership: "≥ v0.1.1",
        },
        {
          stickyBucketing: "≥ v0.1.0",
        },
        {
          encryption: "≥ v0.0.1",
        },
        {
          looseUnmarshalling: "≥ v0.0.1",
        },
        {
          namespacesV2: "≥ v0.0.1",
        },
        {
          prerequisites: "≥ v0.0.1",
        },
        {
          semverTargeting: "≥ v0.0.1",
        },
        {
          bucketingV2: "≥ v0.0.1",
        },
      ],
    },
    java: {
      name: "Java SDK",
      version: "0.10.6",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveRegex: "≥ v0.10.6",
        },
        {
          remoteEvaluation: "≥ v0.9.92",
        },
        {
          prerequisites: "≥ v0.9.3",
        },
        {
          stickyBucketing: "≥ v0.9.3",
        },
        {
          streaming: "≥ v0.9.0",
        },
        {
          semverTargeting: "≥ v0.7.0",
        },
        {
          bucketingV2: "≥ v0.6.0",
        },
        {
          encryption: "≥ v0.3.0",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    csharp: {
      name: "C# SDK",
      version: "1.1.3",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          remoteEvaluation: "≥ v1.1.3",
        },
        {
          stickyBucketing: "≥ v1.1.0",
        },
        {
          prerequisites: "≥ v1.1.0",
        },
        {
          savedGroupReferences: "≥ v1.1.0",
        },
        {
          encryption: "≥ v1.0.0",
        },
        {
          streaming: "≥ v1.0.0",
        },
        {
          bucketingV2: "≥ v1.0.0",
        },
        {
          semverTargeting: "≥ v1.0.0",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    elixir: {
      name: "Elixir SDK",
      version: "0.3.0",
      github: "https://github.com/growthbook/growthbook-elixir",
      examples: [],
      packageRepos: [
        {
          name: "Hex",
          url: "https://www.hex.pm/packages/growthbook",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          encryption: "≥ v0.3.0",
        },
        {
          prerequisites: "≥ v0.2.0",
        },
        {
          semverTargeting: "≥ v0.2.0",
        },
        {
          bucketingV2: "≥ v0.2.0",
        },
        {
          looseUnmarshalling: "≥ v0.2.0",
        },
        {
          namespacesV2: "≥ v0.2.0",
        },
      ],
    },
    kotlin: {
      name: "Kotlin SDK",
      version: "7.1.1",
      github: "https://github.com/growthbook/growthbook-kotlin",
      examples: [],
      packageRepos: [
        {
          name: "Maven Central",
          url: "https://mvnrepository.com/artifact/io.growthbook.sdk/GrowthBook",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveMembership: "≥ v7.1.1",
        },
        {
          caseInsensitiveRegex: "≥ v7.1.1",
        },
        {
          remoteEval: "≥ v1.1.50",
        },
        {
          streaming: "≥ v1.1.50",
        },
        {
          prerequisites: "≥ v1.1.44",
        },
        {
          stickyBucketing: "≥ v1.1.44",
        },
        {
          bucketingV2: "≥ v1.1.38",
        },
        {
          semverTargeting: "≥ v1.1.31",
        },
        {
          encryption: "≥ v1.1.23",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    swift: {
      name: "Swift SDK",
      version: "1.1.4",
      github: "https://github.com/growthbook/growthbook-swift",
      examples: [],
      packageRepos: [
        {
          name: "Swift Package Manager (SPM)",
          url: "https://swiftpackageindex.com/growthbook/growthbook-swift",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          namespacesV2: "≥ v1.1.4",
        },
        {
          caseInsensitiveMembership: "≥ v1.1.1",
        },
        {
          caseInsensitiveRegex: "≥ v1.1.1",
        },
        {
          remoteEval: "≥ v1.0.50",
        },
        {
          stickyBucketing: "≥ v1.0.49",
        },
        {
          prerequisites: "≥ v1.0.49",
        },
        {
          bucketingV2: "≥ v1.0.43",
        },
        {
          streaming: "≥ v1.0.43",
        },
        {
          semverTargeting: "≥ v1.0.38",
        },
        {
          encryption: "≥ v1.0.35",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
      ],
    },
    reactNative: {
      name: "React Native SDK",
      version: "1.6.5",
      github: "https://github.com/growthbook/growthbook/tree/main/packages/sdk-react",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveMembership: "≥ v1.6.4",
        },
        {
          caseInsensitiveRegex: "≥ v1.6.3",
        },
        {
          savedGroupReferences: "≥ v1.1.0",
        },
        {
          redirects: "≥ v0.26.0",
        },
        {
          prerequisites: "≥ v0.24.0",
        },
        {
          stickyBucketing: "≥ v0.22.0",
        },
        {
          visualEditorDragDrop: "≥ v0.20.0",
        },
        {
          remoteEval: "≥ v0.19.0",
        },
        {
          semverTargeting: "≥ v0.17.0",
        },
        {
          visualEditorJS: "≥ v0.17.0",
        },
        {
          visualEditor: "≥ v0.14.0",
        },
        {
          bucketingV2: "≥ v0.13.0",
        },
        {
          streaming: "≥ v0.11.0",
        },
        {
          encryption: "≥ v0.10.1",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    edgeCloudflare: {
      name: "Cloudflare Workers App & SDK",
      version: "0.2.8",
      github: "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-cloudflare",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveRegex: "≥ v0.2.7",
        },
        {
          caseInsensitiveMembership: "≥ v0.2.7",
        },
        {
          savedGroupReferences: "≥ v0.1.12",
        },
        {
          looseUnmarshalling: "≥ v0.1.11",
        },
        {
          namespacesV2: "≥ v0.1.11",
        },
        {
          encryption: "≥ v0.1.11",
        },
        {
          streaming: "≥ v0.1.11",
        },
        {
          bucketingV2: "≥ v0.1.11",
        },
        {
          visualEditor: "≥ v0.1.11",
        },
        {
          semverTargeting: "≥ v0.1.11",
        },
        {
          visualEditorJS: "≥ v0.1.11",
        },
        {
          visualEditorDragDrop: "≥ v0.1.11",
        },
        {
          prerequisites: "≥ v0.1.11",
        },
        {
          redirects: "≥ v0.1.11",
        },
        {
          stickyBucketing: "≥ v0.1.11",
        },
      ],
    },
    edgeFastly: {
      name: "Fastly Compute App & SDK",
      version: "0.2.8",
      github: "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-fastly",
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
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveRegex: "≥ v0.2.7",
        },
        {
          caseInsensitiveMembership: "≥ v0.2.7",
        },
        {
          savedGroupReferences: "≥ v0.1.6",
        },
        {
          looseUnmarshalling: "≥ v0.1.5",
        },
        {
          namespacesV2: "≥ v0.1.5",
        },
        {
          encryption: "≥ v0.1.5",
        },
        {
          streaming: "≥ v0.1.5",
        },
        {
          bucketingV2: "≥ v0.1.5",
        },
        {
          visualEditor: "≥ v0.1.5",
        },
        {
          semverTargeting: "≥ v0.1.5",
        },
        {
          visualEditorJS: "≥ v0.1.5",
        },
        {
          visualEditorDragDrop: "≥ v0.1.5",
        },
        {
          prerequisites: "≥ v0.1.5",
        },
        {
          redirects: "≥ v0.1.5",
        },
        {
          stickyBucketing: "≥ v0.1.5",
        },
      ],
    },
    edgeLambda: {
      name: "Lambda@Edge App & SDK",
      version: "0.0.28",
      github: "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-lambda",
      examples: [],
      packageRepos: [
        {
          name: "npm",
          url: "https://www.npmjs.com/package/@growthbook/edge-lambda",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveRegex: "≥ v0.0.27",
        },
        {
          caseInsensitiveMembership: "≥ v0.0.27",
        },
        {
          savedGroupReferences: "≥ v0.0.7",
        },
        {
          looseUnmarshalling: "≥ v0.0.6",
        },
        {
          namespacesV2: "≥ v0.0.6",
        },
        {
          encryption: "≥ v0.0.6",
        },
        {
          streaming: "≥ v0.0.6",
        },
        {
          bucketingV2: "≥ v0.0.6",
        },
        {
          visualEditor: "≥ v0.0.6",
        },
        {
          semverTargeting: "≥ v0.0.6",
        },
        {
          visualEditorJS: "≥ v0.0.6",
        },
        {
          visualEditorDragDrop: "≥ v0.0.6",
        },
        {
          prerequisites: "≥ v0.0.6",
        },
        {
          redirects: "≥ v0.0.6",
        },
        {
          stickyBucketing: "≥ v0.0.6",
        },
      ],
    },
    edgeUtils: {
      name: "Edge Utils",
      version: "0.2.8",
      github: "https://github.com/growthbook/growthbook-proxy/tree/main/packages/lib/edge-utils",
      examples: [],
      packageRepos: [
        {
          name: "npm",
          url: "https://www.npmjs.com/package/@growthbook/edge-utils",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          caseInsensitiveRegex: "≥ v0.2.7",
        },
        {
          caseInsensitiveMembership: "≥ v0.2.7",
        },
        {
          savedGroupReferences: "≥ v0.1.5",
        },
        {
          looseUnmarshalling: "≥ v0.1.4",
        },
        {
          namespacesV2: "≥ v0.1.4",
        },
        {
          encryption: "≥ v0.1.4",
        },
        {
          streaming: "≥ v0.1.4",
        },
        {
          bucketingV2: "≥ v0.1.4",
        },
        {
          visualEditor: "≥ v0.1.4",
        },
        {
          semverTargeting: "≥ v0.1.4",
        },
        {
          visualEditorJS: "≥ v0.1.4",
        },
        {
          visualEditorDragDrop: "≥ v0.1.4",
        },
        {
          prerequisites: "≥ v0.1.4",
        },
        {
          redirects: "≥ v0.1.4",
        },
        {
          stickyBucketing: "≥ v0.1.4",
        },
      ],
    },
    flutter: {
      name: "Flutter SDK",
      version: "4.2.1",
      github: "https://github.com/growthbook/growthbook-flutter",
      examples: [],
      packageRepos: [
        {
          name: "pub.dev",
          url: "https://pub.dev/packages/growthbook_sdk_flutter",
        },
      ],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          stickyBucketing: "≥ v3.8.0",
        },
        {
          remoteEval: "≥ v3.7.0",
        },
        {
          streaming: "≥ v3.4.0",
        },
        {
          prerequisites: "≥ v3.2.0",
        },
        {
          encryption: "≥ v3.1.0",
        },
        {
          bucketingV2: "≥ v3.1.0",
        },
        {
          semverTargeting: "≥ v3.1.0",
        },
        {
          looseUnmarshalling: "≥ v0.0.0",
        },
        {
          namespacesV2: "≥ v0.0.0",
        },
      ],
    },
    roku: {
      name: "Roku SDK",
      version: "1.3.1",
      github: "https://github.com/growthbook/growthbook-roku",
      examples: [
        {
          url: "https://github.com/growthbook/growthbook-roku/tree/main/examples",
          name: "Roku examples",
        },
        {
          url: "https://www.npmjs.com/package/growthbook-roku",
          name: "npm package",
        },
      ],
      packageRepos: [],
      capabilities: [
        {
          features: "All versions",
        },
        {
          experimentation: "All versions",
        },
        {
          prerequisites: "≥ v1.3.0",
        },
        {
          looseUnmarshalling: "≥ v1.3.0",
        },
        {
          namespacesV2: "≥ v1.3.0",
        },
        {
          semverTargeting: "≥ v1.3.0",
        },
        {
          bucketingV2: "≥ v1.3.0",
        },
      ],
    },
  };

  const capabilityDetails = {
    features: {
      label: "Features",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M42.76,50A8,8,0,0,0,40,56V224a8,8,0,0,0,16,0V179.77c26.79-21.16,49.87-9.75,76.45,3.41,16.4,8.11,34.06,16.85,53,16.85,13.93,0,28.54-4.75,43.82-18a8,8,0,0,0,2.76-6V56A8,8,0,0,0,218.76,50c-28,24.23-51.72,12.49-79.21-1.12C111.07,34.76,78.78,18.79,42.76,50ZM216,172.25c-26.79,21.16-49.87,9.74-76.45-3.41-25-12.35-52.81-26.13-83.55-8.4V59.79c26.79-21.16,49.87-9.75,76.45,3.4,25,12.35,52.82,26.13,83.55,8.4Z" />
        </svg>
      ),
    },
    experimentation: {
      label: "Experimentation",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M221.69,199.77,160,96.92V40h8a8,8,0,0,0,0-16H88a8,8,0,0,0,0,16h8V96.92L34.31,199.77A16,16,0,0,0,48,224H208a16,16,0,0,0,13.72-24.23ZM110.86,103.25A7.93,7.93,0,0,0,112,99.14V40h32V99.14a7.93,7.93,0,0,0,1.14,4.11L183.36,167c-12,2.37-29.07,1.37-51.75-10.11-15.91-8.05-31.05-12.32-45.22-12.81ZM48,208l28.54-47.58c14.25-1.74,30.31,1.85,47.82,10.72,19,9.61,35,12.88,48,12.88a69.89,69.89,0,0,0,19.55-2.7L208,208Z" />
        </svg>
      ),
    },
    encryption: {
      label: "Encrypted Features",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Zm-68-56a12,12,0,1,1-12-12A12,12,0,0,1,140,152Z" />
        </svg>
      ),
    },
    streaming: {
      label: "Streaming",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M135.16,84.42a8,8,0,0,0-14.32,0l-72,144a8,8,0,0,0,14.31,7.16L77,208h102.1l13.79,27.58A8,8,0,0,0,200,240a8,8,0,0,0,7.15-11.58ZM128,105.89,155.06,160H100.94ZM85,192l8-16h70.1l8,16Zm74.54-98.26a32,32,0,1,0-63,0,8,8,0,1,1-15.74,2.85,48,48,0,1,1,94.46,0,8,8,0,0,1-7.86,6.58,8.74,8.74,0,0,1-1.43-.13A8,8,0,0,1,159.49,93.74ZM64.15,136.21a80,80,0,1,1,127.7,0,8,8,0,0,1-12.76-9.65,64,64,0,1,0-102.18,0,8,8,0,0,1-12.76,9.65Z" />
        </svg>
      ),
    },
    bucketingV2: {
      label: "v2 Hashing",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M224,88H175.4l8.47-46.57a8,8,0,0,0-15.74-2.86l-9,49.43H111.4l8.47-46.57a8,8,0,0,0-15.74-2.86L95.14,88H48a8,8,0,0,0,0,16H92.23L83.5,152H32a8,8,0,0,0,0,16H80.6l-8.47,46.57a8,8,0,0,0,6.44,9.3A7.79,7.79,0,0,0,80,224a8,8,0,0,0,7.86-6.57l9-49.43H144.6l-8.47,46.57a8,8,0,0,0,6.44,9.3A7.79,7.79,0,0,0,144,224a8,8,0,0,0,7.86-6.57l9-49.43H208a8,8,0,0,0,0-16H163.77l8.73-48H224a8,8,0,0,0,0-16Zm-76.5,64H99.77l8.73-48h47.73Z" />
        </svg>
      ),
    },
    visualEditor: {
      label: "Visual Editor",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Zm-48,48a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224Z" />
        </svg>
      ),
    },
    semverTargeting: {
      label: "SemVer Targeting",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M208,112a32.05,32.05,0,0,0-30.69,23l-42.21-6a8,8,0,0,1-4.95-2.71L94.43,84.55A32,32,0,1,0,72,87v82a32,32,0,1,0,16,0V101.63l30,35a24,24,0,0,0,14.83,8.14l44,6.28A32,32,0,1,0,208,112ZM64,56A16,16,0,1,1,80,72,16,16,0,0,1,64,56ZM96,200a16,16,0,1,1-16-16A16,16,0,0,1,96,200Zm112-40a16,16,0,1,1,16-16A16,16,0,0,1,208,160Z" />
        </svg>
      ),
    },
    visualEditorJS: {
      label: "Visual Editor (JS)",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40v72a8,8,0,0,0,16,0V40h88V88a8,8,0,0,0,8,8h48V216H176a8,8,0,0,0,0,16h24a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160Zm-12.19,145a20.82,20.82,0,0,1-9.19,15.23C133.43,215,127,216,121.13,216a61.34,61.34,0,0,1-15.19-2,8,8,0,0,1,4.31-15.41c4.38,1.2,15,2.7,19.55-.36.88-.59,1.83-1.52,2.14-3.93.34-2.67-.71-4.1-12.78-7.59-9.35-2.7-25-7.23-23-23.11a20.56,20.56,0,0,1,9-14.95c11.84-8,30.71-3.31,32.83-2.76a8,8,0,0,1-4.07,15.48c-4.49-1.17-15.23-2.56-19.83.56a4.54,4.54,0,0,0-2,3.67c-.12.9-.14,1.09,1.11,1.9,2.31,1.49,6.45,2.68,10.45,3.84C133.49,174.17,150.05,179,147.81,196.31ZM80,152v38a26,26,0,0,1-52,0,8,8,0,0,1,16,0,10,10,0,0,0,20,0V152a8,8,0,0,1,16,0Z" />
        </svg>
      ),
    },
    remoteEval: {
      label: "Remote Evaluation",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M160,40A88.09,88.09,0,0,0,81.29,88.67,64,64,0,1,0,72,216h88a88,88,0,0,0,0-176Zm0,160H72a48,48,0,0,1,0-96c1.1,0,2.2,0,3.29.11A88,88,0,0,0,72,128a8,8,0,0,0,16,0,72,72,0,1,1,72,72Z" />
        </svg>
      ),
    },
    visualEditorDragDrop: {
      label: "Visual Editor Drag & Drop",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M188,80a27.79,27.79,0,0,0-13.36,3.4,28,28,0,0,0-46.64-11A28,28,0,0,0,80,92v20H68a28,28,0,0,0-28,28v12a88,88,0,0,0,176,0V108A28,28,0,0,0,188,80Zm12,72a72,72,0,0,1-144,0V140a12,12,0,0,1,12-12H80v24a8,8,0,0,0,16,0V92a12,12,0,0,1,24,0v28a8,8,0,0,0,16,0V92a12,12,0,0,1,24,0v28a8,8,0,0,0,16,0V108a12,12,0,0,1,24,0Z" />
        </svg>
      ),
    },
    stickyBucketing: {
      label: "Sticky Bucketing",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M223.68,66.15,135.68,18h0a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32h0l80.34,44L128,120,47.66,76ZM40,90l80,43.78v85.79L40,175.82Zm96,129.57V133.82L216,90v85.78Z" />
        </svg>
      ),
    },
    redirects: {
      label: "URL Redirects",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M240,88.23a54.43,54.43,0,0,1-16,37L189.25,160a54.27,54.27,0,0,1-38.63,16h-.05A54.63,54.63,0,0,1,96,119.84a8,8,0,0,1,16,.45A38.62,38.62,0,0,0,150.58,160h0a38.39,38.39,0,0,0,27.31-11.31l34.75-34.75a38.63,38.63,0,0,0-54.63-54.63l-11,11A8,8,0,0,1,135.7,59l11-11A54.65,54.65,0,0,1,224,48,54.86,54.86,0,0,1,240,88.23ZM109,185.66l-11,11A38.41,38.41,0,0,1,70.6,208h0a38.63,38.63,0,0,1-27.29-65.94L78,107.31A38.63,38.63,0,0,1,144,135.71a8,8,0,0,0,16,.45A54.86,54.86,0,0,0,144,96a54.65,54.65,0,0,0-77.27,0L32,130.75A54.62,54.62,0,0,0,70.56,224h0a54.28,54.28,0,0,0,38.64-16l11-11A8,8,0,0,0,109,185.66Z" />
        </svg>
      ),
    },
    prerequisites: {
      label: "Prerequisites",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M176,152h32a16,16,0,0,0,16-16V104a16,16,0,0,0-16-16H176a16,16,0,0,0-16,16v8H88V80h8a16,16,0,0,0,16-16V32A16,16,0,0,0,96,16H64A16,16,0,0,0,48,32V64A16,16,0,0,0,64,80h8V192a24,24,0,0,0,24,24h64v8a16,16,0,0,0,16,16h32a16,16,0,0,0,16-16V192a16,16,0,0,0-16-16H176a16,16,0,0,0-16,16v8H96a8,8,0,0,1-8-8V128h72v8A16,16,0,0,0,176,152ZM64,32H96V64H64ZM176,192h32v32H176Zm0-88h32v32H176Z" />
        </svg>
      ),
    },
    savedGroupReferences: {
      label: "Saved Group References",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M88,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H96A8,8,0,0,1,88,64Zm128,56H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,64H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM56,56H40a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16Zm0,64H40a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16Zm0,64H40a8,8,0,0,0,0,16H56a8,8,0,0,0,0-16Z" />
        </svg>
      ),
    },
    caseInsensitiveRegex: {
      label: "Case Insensitive Regex",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M87.24,52.59a8,8,0,0,0-14.48,0l-64,136a8,8,0,1,0,14.48,6.81L39.9,160h80.2l16.66,35.4a8,8,0,1,0,14.48-6.81ZM47.43,144,80,74.79,112.57,144ZM200,96c-12.76,0-22.73,3.47-29.63,10.32a8,8,0,0,0,11.26,11.36c3.8-3.77,10-5.68,18.37-5.68,13.23,0,24,9,24,20v3.22A42.76,42.76,0,0,0,200,128c-22.06,0-40,16.15-40,36s17.94,36,40,36a42.73,42.73,0,0,0,24-7.25,8,8,0,0,0,16-.75V132C240,112.15,222.06,96,200,96Zm0,88c-13.23,0-24-9-24-20s10.77-20,24-20,24,9,24,20S213.23,184,200,184Z" />
        </svg>
      ),
    },
    caseInsensitiveMembership: {
      label: "Case Insensitive Membership",
      icon: () => (
        <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
          <path d="M174.63,81.37a80,80,0,1,0-93.26,93.26,80,80,0,1,0,93.26-93.26ZM224,160c0,1.52-.07,3-.18,4.51l-50-50A80,80,0,0,0,176,98,64.11,64.11,0,0,1,224,160Zm-13.47,39.21L157.91,146.6a80.5,80.5,0,0,0,9.93-15.44L219.7,183A64,64,0,0,1,210.53,199.21ZM183,219.7l-51.86-51.86a80.5,80.5,0,0,0,15.44-9.93l52.61,52.62A64,64,0,0,1,183,219.7ZM45.47,56.79,98.09,109.4a80.5,80.5,0,0,0-9.93,15.44L36.3,73A64,64,0,0,1,45.47,56.79ZM73,36.3l51.86,51.86a80.5,80.5,0,0,0-15.44,9.93L56.79,45.47A64,64,0,0,1,73,36.3ZM160,96a64.07,64.07,0,0,1-64,64A64.07,64.07,0,0,1,160,96Zm-2-16a80,80,0,0,0-16.49,2.13l-50-50C93,32.07,94.48,32,96,32A64.11,64.11,0,0,1,158,80.05ZM32,96c0-1.52.07-3,.18-4.51l50,50A80,80,0,0,0,80.05,158,64.11,64.11,0,0,1,32,96ZM98,176a80,80,0,0,0,16.49-2.13l50,50c-1.49.11-3,.18-4.51.18A64.11,64.11,0,0,1,98,176Z" />
        </svg>
      ),
    },
  };

  const capabilities = (sdkInfo[sdk].capabilities || [])
    .filter((cap) => {
      const feature = Object.keys(cap)[0];
      return !cap.looseUnmarshalling && capabilityDetails[feature];
    })
    .map((cap) => {
      const feature = Object.keys(cap)[0];
      return { feature, version: cap[feature] };
    });

  return (
    <div className="flex flex-row flex-wrap gap-[10px] mb-4">
      {capabilities.map(({ feature, version }) => (
        <div
          key={feature}
          className="inline-flex flex-row gap-[6px] items-center bg-[var(--slate-a3)] rounded-full px-3 h-7 text-[14px] leading-none dark:text-[#f5f7f5]"
        >
          <span className="inline-flex items-center justify-center w-4 h-4 shrink-0 [&_svg]:w-full [&_svg]:h-full [&_svg]:fill-current">
            {capabilityDetails[feature].icon()}
          </span>
          <span className="group relative cursor-pointer">
            {capabilityDetails[feature].label}
            <span className="invisible opacity-0 transition-opacity duration-200 group-hover:visible group-hover:opacity-100 absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 w-max max-w-[220px] bg-[#444] text-white text-[13px] text-center rounded px-[10px] py-[6px] z-10 pointer-events-none group-hover:pointer-events-auto shadow-md after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-[6px] after:border-solid after:border-transparent after:border-t-[#444]">
              {version}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
};
