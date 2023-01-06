import { SDKLanguage } from "back-end/types/sdk-connection";
import { IconType } from "react-icons";
import { DiRuby, DiPython, DiReact, DiAndroid } from "react-icons/di";
import { FaHashtag, FaApple, FaJava, FaCode } from "react-icons/fa";
import { SiFlutter, SiGo, SiJavascript, SiPhp } from "react-icons/si";

export const languageMapping: Record<
  SDKLanguage,
  { Icon: IconType; color: string; label: string }
> = {
  react: {
    Icon: DiReact,
    color: "#61DBFB",
    label: "ReactJS",
  },
  ruby: {
    Icon: DiRuby,
    color: "#A91401",
    label: "Ruby",
  },
  python: {
    Icon: DiPython,
    color: "#306998",
    label: "Python",
  },
  android: {
    Icon: DiAndroid,
    color: "#78C257",
    label: "Android (Kotlin)",
  },
  csharp: {
    Icon: FaHashtag,
    color: "#684D95",
    label: "C Sharp",
  },
  flutter: {
    Icon: SiFlutter,
    color: "#02569B",
    label: "Flutter (Dart)",
  },
  go: {
    Icon: SiGo,
    color: "#29BEB0",
    label: "Golang",
  },
  ios: {
    Icon: FaApple,
    color: "#000000",
    label: "iOS (Swift)",
  },
  java: {
    Icon: FaJava,
    color: "#f89820",
    label: "Java",
  },
  javascript: {
    Icon: SiJavascript,
    color: "#f7df1e",
    label: "Javascript",
  },
  php: {
    Icon: SiPhp,
    color: "#8993be",
    label: "PHP",
  },
  other: {
    Icon: FaCode,
    color: "#777",
    label: "Other",
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
