import clsx from "clsx";
import { CSSProperties } from "react";
import { Language } from "./Code";

export interface Props {
  code: string;
  style: {
    [key: string]: CSSProperties;
  };
  language: Language;
  className?: string;
}

export default function PrismFallback({
  className,
  style,
  language,
  code,
}: Props) {
  // This is a fallback while the full syntax highlighter loads
  // Since we have the exact same styles, it shouldn't cause any layout shifts.
  return (
    <pre
      className={clsx(className, `language-${language}`)}
      style={style['pre[class*="language-"]']}
    >
      <code
        className={`language-${language}`}
        style={style['code[class*="language-"]']}
      >
        {code}
      </code>
    </pre>
  );
}
