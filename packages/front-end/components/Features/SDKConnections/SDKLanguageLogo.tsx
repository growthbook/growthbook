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
  SiFastly,
} from "react-icons/si";
import React, { ReactElement } from "react";
import { isSDKOutdated } from "shared/sdk-versioning";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { BsCloudFog2, BsFiletypeHtml } from "react-icons/bs";
import { DocSection } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";

export type LanguageFilter =
  | "popular"
  | "all"
  | "browser"
  | "server"
  | "mobile"
  | "edge";
export type LanguageType =
  | "frontend"
  | "backend"
  | "mobile"
  | "edge"
  | "nocode"
  | "other";
export type LanguageLogo = {
  Icon: IconType;
  color: string;
  label: string;
  docLabel?: string;
  docs: DocSection;
  type: LanguageType;
  filters: LanguageFilter[];
  hideVersion?: boolean;
  extra?: ReactElement | string;
};
export const languageMapping: Record<SDKLanguage, LanguageLogo> = {
  "nocode-other": {
    Icon: BsFiletypeHtml,
    color: "#777",
    label: "Script Tag",
    docLabel: "HTML Script Tag",
    docs: "nocode",
    type: "nocode",
    filters: ["browser", "popular"],
    hideVersion: true,
  },
  javascript: {
    Icon: SiJavascript,
    color: "#f7df1e",
    label: "JavaScript",
    docs: "javascript",
    type: "frontend",
    filters: ["browser", "popular"],
  },
  react: {
    Icon: DiReact,
    color: "#61DBFB",
    label: "React",
    docs: "tsx",
    type: "frontend",
    filters: ["browser", "mobile", "popular"],
  },
  nodejs: {
    Icon: SiNodedotjs,
    color: "#339933",
    label: "Node.js",
    docs: "javascript",
    type: "backend",
    filters: ["server", "popular"],
  },
  php: {
    Icon: SiPhp,
    color: "#8993be",
    label: "PHP",
    docs: "php",
    type: "backend",
    filters: ["server", "popular"],
  },
  ruby: {
    Icon: DiRuby,
    color: "#A91401",
    label: "Ruby",
    docs: "ruby",
    type: "backend",
    filters: ["server", "popular"],
  },
  python: {
    Icon: DiPython,
    color: "#306998",
    label: "Python",
    docs: "python",
    type: "backend",
    filters: ["server", "popular"],
  },
  java: {
    Icon: FaJava,
    color: "#f89820",
    label: "Java",
    docs: "java",
    type: "backend",
    filters: ["server", "popular"],
  },
  csharp: {
    Icon: FaHashtag,
    color: "#684D95",
    label: "C Sharp",
    docs: "csharp",
    type: "backend",
    filters: ["server"],
  },
  go: {
    Icon: SiGo,
    color: "#29BEB0",
    label: "Golang",
    docs: "go",
    type: "backend",
    filters: ["server"],
  },
  elixir: {
    Icon: SiElixir,
    color: "#543364",
    label: "Elixir",
    docs: "elixir",
    type: "backend",
    filters: ["server"],
  },
  ios: {
    Icon: FaApple,
    color: "#000000",
    label: "Swift",
    docs: "swift",
    type: "mobile",
    filters: ["mobile", "popular"],
  },
  android: {
    Icon: DiAndroid,
    color: "#78C257",
    label: "Kotlin",
    docs: "kotlin",
    type: "mobile",
    filters: ["mobile", "popular"],
  },
  flutter: {
    Icon: SiFlutter,
    color: "#02569B",
    label: "Flutter",
    docs: "flutter",
    type: "mobile",
    filters: ["mobile"],
  },
  "edge-cloudflare": {
    Icon: SiCloudflare,
    color: "#f78220",
    label: "Cloudflare",
    docLabel: "Cloudflare Workers",
    docs: "cloudflare",
    type: "edge",
    filters: ["edge", "popular"],
    extra: (
      <span
        className="badge badge-purple text-uppercase position-absolute"
        style={{ top: -16, right: -12 }}
      >
        Beta
      </span>
    ),
  },
  "edge-fastly": {
    Icon: SiFastly,
    color: "#ec1a0c",
    label: "Fastly",
    docLabel: "Fastly Compute",
    docs: "edge",
    type: "edge",
    filters: ["edge"],
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
    filters: ["edge"],
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
    filters: ["edge"],
    extra: (
      <span
        className="badge badge-yellow text-uppercase position-absolute"
        style={{ top: -16, right: -12 }}
      >
        Alpha
      </span>
    ),
  },
  "nocode-shopify": {
    Icon: SiShopify,
    color: "#95BF47",
    label: "Shopify",
    docs: "shopify",
    type: "nocode",
    filters: ["browser"],
    hideVersion: true,
  },
  "nocode-wordpress": {
    Icon: SiWordpress,
    color: "#00749C",
    label: "Wordpress",
    docs: "wordpress",
    type: "nocode",
    filters: ["browser"],
    hideVersion: true,
  },
  "nocode-webflow": {
    Icon: SiWebflow,
    color: "#146EF5",
    label: "Webflow",
    docs: "webflow",
    type: "nocode",
    filters: ["browser", "popular"],
    hideVersion: true,
  },
  other: {
    Icon: FaCode,
    color: "#777",
    label: "Other",
    docs: "sdks",
    type: "other",
    filters: [],
    hideVersion: true,
  },
};

export default function SDKLanguageLogo({
  language,
  showLabel = false,
  size = 25,
  titlePrefix = "",
  version,
  hideExtra,
}: {
  language: SDKLanguage;
  showLabel?: boolean;
  size?: number;
  titlePrefix?: string;
  version?: string;
  hideExtra?: boolean;
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
      {!hideExtra ? extra : null}
    </span>
  );
}

export function getLanguagesByFilter(
  languageFilter: LanguageFilter = "all"
): SDKLanguage[] {
  return Object.entries(languageMapping)
    .filter(([_, language]) => {
      if (languageFilter === "all") return true;
      return language.filters.includes(languageFilter);
    })
    .map((o) => o[0]) as SDKLanguage[];
}

export function getConnectionLanguageFilter(
  languages: SDKLanguage[]
): LanguageFilter {
  const languageFilters = new Set<LanguageFilter>();
  languages.forEach((language) => {
    const type = languageMapping?.[language]?.type;
    if (type) {
      languageFilters.add(
        type
          // todo: only use filters (not types) to make this consistent
          .replace("frontend", "browser")
          .replace("nocode", "browser")
          .replace("backend", "server")
          .replace("other", "all") as LanguageFilter
      );
    }
  });
  if (languageFilters.size === 0) {
    return "popular";
  }
  if (languageFilters.size === 1) {
    return [...languageFilters][0];
  }
  return "all";
}
