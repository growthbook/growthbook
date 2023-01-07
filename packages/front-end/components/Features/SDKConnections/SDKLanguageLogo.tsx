import { SDKLanguage } from "back-end/types/sdk-connection";
import { IconType } from "react-icons";
import { DiRuby, DiPython, DiReact, DiAndroid } from "react-icons/di";
import { FaHashtag, FaApple, FaJava, FaCode } from "react-icons/fa";
import { SiFlutter, SiGo, SiJavascript, SiPhp } from "react-icons/si";
import { DocSection } from "@/components/DocLink";

export const languageMapping: Record<
  SDKLanguage,
  { Icon: IconType; color: string; label: string; docs: DocSection }
> = {
  react: {
    Icon: DiReact,
    color: "#61DBFB",
    label: "ReactJS",
    docs: "tsx",
  },
  ruby: {
    Icon: DiRuby,
    color: "#A91401",
    label: "Ruby",
    docs: "ruby",
  },
  python: {
    Icon: DiPython,
    color: "#306998",
    label: "Python",
    docs: "python",
  },
  android: {
    Icon: DiAndroid,
    color: "#78C257",
    label: "Android (Kotlin)",
    docs: "kotlin",
  },
  csharp: {
    Icon: FaHashtag,
    color: "#684D95",
    label: "C Sharp",
    docs: "sdks",
  },
  flutter: {
    Icon: SiFlutter,
    color: "#02569B",
    label: "Flutter (Dart)",
    docs: "sdks",
  },
  go: {
    Icon: SiGo,
    color: "#29BEB0",
    label: "Golang",
    docs: "go",
  },
  ios: {
    Icon: FaApple,
    color: "#000000",
    label: "iOS (Swift)",
    docs: "sdks",
  },
  java: {
    Icon: FaJava,
    color: "#f89820",
    label: "Java",
    docs: "java",
  },
  javascript: {
    Icon: SiJavascript,
    color: "#f7df1e",
    label: "Javascript",
    docs: "javascript",
  },
  php: {
    Icon: SiPhp,
    color: "#8993be",
    label: "PHP",
    docs: "php",
  },
  other: {
    Icon: FaCode,
    color: "#777",
    label: "Other",
    docs: "sdks",
  },
};

export default function SDKLanguageLogo({
  language,
  showLabel = false,
  size = 25,
}: {
  language: SDKLanguage;
  showLabel?: boolean;
  size?: number;
}) {
  const { Icon, color, label } =
    languageMapping[language] || languageMapping["other"];

  return (
    <span className="d-inline-flex align-items-center">
      <Icon
        style={{ color, height: size, fontSize: size, lineHeight: size }}
        className="m-0"
        title={label}
      />
      {showLabel && <span className="ml-1">{label}</span>}
    </span>
  );
}
