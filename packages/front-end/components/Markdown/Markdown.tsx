import { DetailedHTMLProps, FC, HTMLAttributes } from "react";
import markdown from "markdown-it";
import sanitizer from "markdown-it-sanitizer";
import mark from "markdown-it-mark";
import clsx from "clsx";
import styles from "./Markdown.module.scss";

const md = markdown({ html: true, linkify: true }).use(sanitizer).use(mark);

const Markdown: FC<
  DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>
> = ({ children, className, ...props }) => {
  if (typeof children !== "string") {
    console.error(
      "The Markdown component expects a single string as child. Received",
      typeof children
    );
  }

  const text = typeof children === "string" ? children : "";

  return (
    <div
      {...props}
      className={clsx(className, styles.markdown)}
      dangerouslySetInnerHTML={{
        __html: md.render(text),
      }}
    />
  );
};
export default Markdown;
