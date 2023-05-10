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
} from "react-icons/si";
import { DocSection } from "@/components/DocLink";

export const languageMapping: Record<
  SDKLanguage,
  {
    Icon: IconType;
    color: string;
    label: string;
    docs: DocSection;
    supportsEncryption: boolean;
    supportsHashedAttributes: boolean;
    supportsVisualExperiments: boolean;
    supportsSSE: boolean;
  }
> = {
  react: {
    Icon: DiReact,
    color: "#61DBFB",
    label: "React",
    docs: "tsx",
    supportsEncryption: true,
    supportsHashedAttributes: true,
    supportsVisualExperiments: true,
    supportsSSE: true,
  },
  ruby: {
    Icon: DiRuby,
    color: "#A91401",
    label: "Ruby",
    docs: "ruby",
    supportsEncryption: false,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  python: {
    Icon: DiPython,
    color: "#306998",
    label: "Python",
    docs: "python",
    supportsEncryption: true,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  android: {
    Icon: DiAndroid,
    color: "#78C257",
    label: "Kotlin",
    docs: "kotlin",
    supportsEncryption: false,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  csharp: {
    Icon: FaHashtag,
    color: "#684D95",
    label: "C Sharp",
    docs: "csharp",
    supportsEncryption: false,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  flutter: {
    Icon: SiFlutter,
    color: "#02569B",
    label: "Flutter",
    docs: "flutter",
    supportsEncryption: false,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  go: {
    Icon: SiGo,
    color: "#29BEB0",
    label: "Golang",
    docs: "go",
    supportsEncryption: false,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  ios: {
    Icon: FaApple,
    color: "#000000",
    label: "Swift",
    docs: "swift",
    supportsEncryption: true,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  java: {
    Icon: FaJava,
    color: "#f89820",
    label: "Java",
    docs: "java",
    supportsEncryption: true,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  javascript: {
    Icon: SiJavascript,
    color: "#f7df1e",
    label: "Javascript",
    docs: "javascript",
    supportsEncryption: true,
    supportsHashedAttributes: true,
    supportsVisualExperiments: true,
    supportsSSE: true,
  },
  php: {
    Icon: SiPhp,
    color: "#8993be",
    label: "PHP",
    docs: "php",
    supportsEncryption: true,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
  nodejs: {
    Icon: SiNodedotjs,
    color: "#339933",
    label: "Node.js",
    docs: "javascript",
    supportsEncryption: true,
    supportsHashedAttributes: true,
    supportsVisualExperiments: false,
    supportsSSE: true,
  },
  other: {
    Icon: FaCode,
    color: "#777",
    label: "Other",
    docs: "sdks",
    supportsEncryption: false,
    supportsHashedAttributes: false,
    supportsVisualExperiments: false,
    supportsSSE: false,
  },
};

export default function SDKLanguageLogo({
  language,
  showLabel = false,
  size = 25,
  titlePrefix = "",
}: {
  language: SDKLanguage;
  showLabel?: boolean;
  size?: number;
  titlePrefix?: string;
}) {
  const { Icon, color, label } =
    languageMapping[language] || languageMapping["other"];

  return (
    <span className="d-inline-flex align-items-center">
      <Icon
        style={{ color, height: size, fontSize: size, lineHeight: size }}
        className="m-0"
        title={titlePrefix + label}
      />
      {showLabel && <span className="ml-1">{label}</span>}
    </span>
  );
}
