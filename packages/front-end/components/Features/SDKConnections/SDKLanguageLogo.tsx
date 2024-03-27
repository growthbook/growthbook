import { SDKLanguage } from "back-end/types/sdk-connection";
import { IconType } from "react-icons";
import { DiRuby, DiPython, DiReact, DiAndroid } from "react-icons/di";
import { FaHashtag, FaApple, FaJava, FaCode } from "react-icons/fa";
import {
  SiFlutter,
  SiGo,
  SiJavascript,
  SiNodedotjs,
  SiPhp,
  SiShopify,
  SiWebflow,
  SiWordpress,
} from "react-icons/si";
import { ReactElement } from "react";
import { isSDKOutdated } from "shared/sdk-versioning";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { BsFiletypeHtml } from "react-icons/bs";
import { DocSection } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";

export type LanguageEnvironment = "frontend" | "backend" | "mobile" | "hybrid";
export const languageMapping: Record<
  SDKLanguage,
  {
    Icon: IconType;
    color: string;
    label: string;
    docs: DocSection;
    environment: LanguageEnvironment;
    hideVersion?: boolean;
  }
> = {
  "nocode-shopify": {
    Icon: SiShopify,
    color: "#95BF47",
    label: "Shopify",
    docs: "shopify",
    environment: "frontend",
    hideVersion: true,
  },
  "nocode-wordpress": {
    Icon: SiWordpress,
    color: "#00749C",
    label: "Wordpress",
    docs: "wordpress",
    environment: "frontend",
    hideVersion: true,
  },
  "nocode-webflow": {
    Icon: SiWebflow,
    color: "#146EF5",
    label: "Webflow",
    docs: "webflow",
    environment: "frontend",
    hideVersion: true,
  },
  "nocode-other": {
    Icon: BsFiletypeHtml,
    color: "#777",
    label: "Generic",
    docs: "nocode",
    environment: "frontend",
    hideVersion: true,
  },
  javascript: {
    Icon: SiJavascript,
    color: "#f7df1e",
    label: "Javascript",
    docs: "javascript",
    environment: "frontend",
  },
  react: {
    Icon: DiReact,
    color: "#61DBFB",
    label: "React",
    docs: "tsx",
    environment: "frontend",
  },
  nodejs: {
    Icon: SiNodedotjs,
    color: "#339933",
    label: "Node.js",
    docs: "javascript",
    environment: "backend",
  },
  php: {
    Icon: SiPhp,
    color: "#8993be",
    label: "PHP",
    docs: "php",
    environment: "backend",
  },
  ruby: {
    Icon: DiRuby,
    color: "#A91401",
    label: "Ruby",
    docs: "ruby",
    environment: "backend",
  },
  python: {
    Icon: DiPython,
    color: "#306998",
    label: "Python",
    docs: "python",
    environment: "backend",
  },
  java: {
    Icon: FaJava,
    color: "#f89820",
    label: "Java",
    docs: "java",
    environment: "backend",
  },
  csharp: {
    Icon: FaHashtag,
    color: "#684D95",
    label: "C Sharp",
    docs: "csharp",
    environment: "backend",
  },
  go: {
    Icon: SiGo,
    color: "#29BEB0",
    label: "Golang",
    docs: "go",
    environment: "backend",
  },
  ios: {
    Icon: FaApple,
    color: "#000000",
    label: "Swift",
    docs: "swift",
    environment: "mobile",
  },
  android: {
    Icon: DiAndroid,
    color: "#78C257",
    label: "Kotlin",
    docs: "kotlin",
    environment: "mobile",
  },
  flutter: {
    Icon: SiFlutter,
    color: "#02569B",
    label: "Flutter",
    docs: "flutter",
    environment: "mobile",
  },
  other: {
    Icon: FaCode,
    color: "#777",
    label: "Other",
    docs: "sdks",
    environment: "hybrid",
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
  const { Icon, color, label, hideVersion } =
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
    <span className="d-inline-flex align-items-center">
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
    </span>
  );
}
