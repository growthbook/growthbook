import { SDKLanguage } from "back-end/types/sdk-connection";
import { IconType } from "react-icons";
import { DiRuby, DiPython, DiReact, DiAndroid } from "react-icons/di";
import { FaHashtag, FaApple, FaJava, FaCode } from "react-icons/fa";
import {
  SiAwslambda,
  SiCloudflare,
  SiFlutter,
  SiGo,
  SiJavascript,
  SiNodedotjs,
  SiPhp,
  SiShopify,
  SiWebflow,
  SiWordpress,
  SiElixir,
} from "react-icons/si";
import React, { ReactElement } from "react";
import { isSDKOutdated } from "shared/sdk-versioning";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { BsCloudFog2, BsFiletypeHtml } from "react-icons/bs";
import { DocSection } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";

export type LanguageType =
  | "frontend"
  | "backend"
  | "mobile"
  | "nocode"
  | "edge"
  | "other";
export const languageMapping: Record<
  SDKLanguage,
  {
    Icon: IconType;
    color: string;
    label: string;
    docLabel?: string;
    docs: DocSection;
    type: LanguageType;
    hideVersion?: boolean;
    extra?: ReactElement | string;
  }
> = {
  "nocode-shopify": {
    Icon: SiShopify,
    color: "#95BF47",
    label: "Shopify",
    docs: "shopify",
    type: "nocode",
    hideVersion: true,
  },
  "nocode-wordpress": {
    Icon: SiWordpress,
    color: "#00749C",
    label: "Wordpress",
    docs: "wordpress",
    type: "nocode",
    hideVersion: true,
  },
  "nocode-webflow": {
    Icon: SiWebflow,
    color: "#146EF5",
    label: "Webflow",
    docs: "webflow",
    type: "nocode",
    hideVersion: true,
  },
  "nocode-other": {
    Icon: BsFiletypeHtml,
    color: "#777",
    label: "Generic",
    docLabel: "HTML Script Tag",
    docs: "nocode",
    type: "nocode",
    hideVersion: true,
  },
  javascript: {
    Icon: SiJavascript,
    color: "#f7df1e",
    label: "JavaScript",
    docs: "javascript",
    type: "frontend",
  },
  react: {
    Icon: DiReact,
    color: "#61DBFB",
    label: "React",
    docs: "tsx",
    type: "frontend",
  },
  nodejs: {
    Icon: SiNodedotjs,
    color: "#339933",
    label: "Node.js",
    docs: "javascript",
    type: "backend",
  },
  php: {
    Icon: SiPhp,
    color: "#8993be",
    label: "PHP",
    docs: "php",
    type: "backend",
  },
  ruby: {
    Icon: DiRuby,
    color: "#A91401",
    label: "Ruby",
    docs: "ruby",
    type: "backend",
  },
  python: {
    Icon: DiPython,
    color: "#306998",
    label: "Python",
    docs: "python",
    type: "backend",
  },
  java: {
    Icon: FaJava,
    color: "#f89820",
    label: "Java",
    docs: "java",
    type: "backend",
  },
  csharp: {
    Icon: FaHashtag,
    color: "#684D95",
    label: "C Sharp",
    docs: "csharp",
    type: "backend",
  },
  go: {
    Icon: SiGo,
    color: "#29BEB0",
    label: "Golang",
    docs: "go",
    type: "backend",
  },
  elixir: {
    Icon: SiElixir,
    color: "#543364",
    label: "Elixir",
    docs: "elixir",
    type: "backend",
  },
  ios: {
    Icon: FaApple,
    color: "#000000",
    label: "Swift",
    docs: "swift",
    type: "mobile",
  },
  android: {
    Icon: DiAndroid,
    color: "#78C257",
    label: "Kotlin",
    docs: "kotlin",
    type: "mobile",
  },
  flutter: {
    Icon: SiFlutter,
    color: "#02569B",
    label: "Flutter",
    docs: "flutter",
    type: "mobile",
  },
  "edge-cloudflare": {
    Icon: SiCloudflare,
    color: "#f78220",
    label: "CloudFlare",
    docLabel: "CloudFlare Workers",
    docs: "cloudflare",
    type: "edge",
    extra: (
      <span
        className="badge badge-purple text-uppercase position-absolute"
        style={{ top: -16, right: -12 }}
      >
        Beta
      </span>
    ),
  },
  "edge-lambda": {
    Icon: SiAwslambda,
    color: "#e57714",
    label: "Lambda@Edge",
    docs: "lambda",
    type: "edge",
    extra: (
      <span
        className="badge badge-yellow text-uppercase position-absolute"
        style={{ top: -16, right: -16 }}
      >
        Alpha
      </span>
    ),
  },
  "edge-other": {
    Icon: BsCloudFog2,
    color: "#777",
    label: "Other",
    docLabel: "Other Edge",
    docs: "edge",
    type: "edge",
    extra: (
      <span
        className="badge badge-purple text-uppercase position-absolute"
        style={{ top: -16, right: -12 }}
      >
        Beta
      </span>
    ),
  },
  other: {
    Icon: FaCode,
    color: "#777",
    label: "Other",
    docs: "sdks",
    type: "other",
    hideVersion: true,
  },
};

export default function SDKLanguageLogo({
  language,
  showLabel = false,
  size = 25,
  titlePrefix = "",
  version,
}: {
  language: SDKLanguage;
  showLabel?: boolean;
  size?: number;
  titlePrefix?: string;
  version?: string;
}) {
  const { Icon, color, label, hideVersion, extra } =
    languageMapping[language] || languageMapping["other"];

  const versionOutdated = isSDKOutdated(language, version);

  let versionText: ReactElement | null = null;
  if (version !== undefined && !hideVersion) {
    versionText = (
      <>
        <span className="text-info small ml-2">ver. {version || "0"}</span>
        {versionOutdated && (
          <Tooltip body={<>A new SDK version may be available</>}>
            <HiOutlineExclamationCircle
              className="text-warning-orange position-relative"
              style={{ top: -2, left: 2 }}
            />
          </Tooltip>
        )}
      </>
    );
  }

  return (
    <span className="d-inline-flex align-items-center position-relative">
      <Icon
        style={{ color, height: size, fontSize: size, lineHeight: size }}
        className="m-0"
        title={titlePrefix + label}
      />
      {showLabel && (
        <span className="ml-1">
          {label}
          {versionText}
        </span>
      )}
      {extra}
    </span>
  );
}

export function getLanguagesByType(
  languageType: LanguageType | ""
): SDKLanguage[] {
  if (!languageType) return [];
  return Object.entries(languageMapping)
    .filter(([_, language]) => language.type === languageType)
    .map((o) => o[0]) as SDKLanguage[];
}

export function getConnectionLanguageType(
  languages: SDKLanguage[]
): LanguageType | "multi" | "" {
  const languageTypes = new Set<LanguageType>();
  languages.forEach((language) => {
    const type = languageMapping?.[language]?.type;
    if (type) {
      languageTypes.add(type);
    }
  });
  if (languageTypes.size === 0) {
    return "";
  }
  if (languageTypes.size === 1) {
    return [...languageTypes][0];
  }
  return "multi";
}
