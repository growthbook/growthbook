import { DetailedHTMLProps, FC, HTMLAttributes } from "react";
import clsx from "clsx";
import styles from "./Markdown.module.scss";
import AuthorizedImage from "../AuthorizedImage";
import ReactMarkdown from "react-markdown";

const imageCache = {};

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
    <div {...props} className={clsx(className, styles.markdown)}>
      <ReactMarkdown
        components={{
          img: ({ ...props }) => (
            <AuthorizedImage imageCache={imageCache} {...props} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
export default Markdown;
