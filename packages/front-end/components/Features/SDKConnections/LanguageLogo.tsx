import { SDKLanguage } from "back-end/types/sdk-connection";
import { IconType } from "react-icons";
import {
  DiRuby,
  DiPython,
  DiReact,
  DiJavascript,
  DiPhp,
  DiJava,
  DiDart,
  DiAndroid,
  DiGo,
} from "react-icons/di";
import { SiCsharp, SiIos } from "react-icons/si";

const languageMapping: Record<
  SDKLanguage,
  { Icon: IconType; color: string }
> = {
  react: {
    Icon: DiReact,
    color: "#61DBFB",
  },
  ruby: {
    Icon: DiRuby,
    color: "#A91401",
  },
  python: {
    Icon: DiPython,
    color: "#306998",
  },
  android: {
    Icon: DiAndroid,
    color: "#78C257",
  },
  csharp: {
    Icon: SiCsharp,
    color: "#684D95",
  },
  flutter: {
    Icon: DiDart,
    color: "#02569B",
  },
  go: {
    Icon: DiGo,
    color: "#29BEB0",
  },
  ios: {
    Icon: SiIos,
    color: "#000000",
  },
  java: {
    Icon: DiJava,
    color: "#f89820",
  },
  javascript: {
    Icon: DiJavascript,
    color: "#f7df1e",
  },
  php: {
    Icon: DiPhp,
    color: "#8993be",
  },
};

export default function LanguageLogo({ language }: { language: SDKLanguage }) {
  const { Icon, color } = languageMapping[language];

  return <Icon style={{ color, fontSize: "1.2em" }} title={language} />;
}
