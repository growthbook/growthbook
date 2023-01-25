import { SDKLanguage } from "back-end/types/sdk-connection";
import Code from "../Code";

export default function InstallationCodeSnippet({
  language,
}: {
  language: SDKLanguage;
}) {
  if (language === "javascript") {
    return (
      <Code
        language="sh"
        code={`
npm i --save @growthbook/growthbook
# OR
yarn add @growthbook/growthbook`.trim()}
      />
    );
  }
  if (language === "react") {
    return (
      <Code
        language="sh"
        code={`
npm i --save @growthbook/growthbook-react
# OR
yarn add @growthbook/growthbook-react`.trim()}
      />
    );
  }
  if (language === "nodejs") {
    return (
      <Code
        language="sh"
        code={`
npm i --save @growthbook/growthbook
# OR
yarn add @growthbook/growthbook`.trim()}
      />
    );
  }
  if (language === "android") {
    return (
      <Code
        language="javascript"
        filename="build.gradle"
        code={`
repositories {
    mavenCentral()
}

dependencies {
    implementation 'io.growthbook.sdk:GrowthBook:1.+'
}`.trim()}
      />
    );
  }
  if (language === "ios") {
    return (
      <>
        <div className="mb-3">
          Cocoapods
          <Code
            language="javascript"
            filename="Podfile"
            code={`
source 'https://github.com/CocoaPods/Specs.git'

target 'MyApp' do
  pod 'GrowthBook-IOS'
end
          `.trim()}
          />
          <Code language="sh" code={"pod install"} />
        </div>
        <div className="mb-3">
          Swift Package Manager (SPM)
          <Code
            language="swift"
            filename="Package.swift"
            code={`
dependencies: [
  .package(url: "https://github.com/growthbook/growthbook-swift.git")
]
            `.trim()}
          />
        </div>
      </>
    );
  }
  if (language === "go") {
    return (
      <Code
        language="sh"
        code="go get github.com/growthbook/growthbook-golang"
      />
    );
  }
  if (language === "ruby") {
    return <Code language="sh" code={`gem install growthbook`} />;
  }
  if (language === "php") {
    return (
      <Code language="sh" code={`composer require growthbook/growthbook`} />
    );
  }
  if (language === "python") {
    return <Code language="sh" code={`pip install growthbook`} />;
  }
  if (language === "java") {
    return (
      <>
        <div className="mb-3">
          Maven
          <Code
            language="xml"
            code={`
<repositories>
  <repository>
    <id>jitpack.io</id>
    <url>https://jitpack.io</url>
  </repository>
</repositories>

<dependency>
  <groupId>com.github.growthbook</groupId>
  <artifactId>growthbook-sdk-java</artifactId>
  <version>0.2.2</version>
</dependency>
`.trim()}
          />
        </div>
        <div className="mb-3">
          Gradle
          <Code
            language="javascript"
            filename="build.gradle"
            code={`
allprojects {
    repositories {
        maven { url 'https://jitpack.io' }
    }
}
dependencies {
    implementation 'com.github.growthbook:growthbook-sdk-java:0.2.2'
}`.trim()}
          />
        </div>
      </>
    );
  }
  if (language === "flutter") {
    return (
      <Code
        language="yml"
        filename="pubspec.yml"
        code="growthbook_sdk_flutter: ^1.0.0"
      />
    );
  }
  if (language === "csharp") {
    return <Code language="sh" code="dotnet add package growthbook-c-sharp" />;
  }

  return <em>Depends on your platform</em>;
}
