import clsx from "clsx";
import { CSSProperties } from "react";
import { Language } from "../Code";

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
