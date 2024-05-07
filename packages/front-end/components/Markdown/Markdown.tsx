import { DetailedHTMLProps, FC, HTMLAttributes } from "react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AuthorizedImage from "@/components/AuthorizedImage";
import styles from "./Markdown.module.scss";

const imageCache = {};

const Markdown: FC<
  DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>
> = ({ children, className, ...props }) => {
  if (typeof children !== "string") {
    console.error(
      "The Markdown component expects a single string as child. Received",
      typeof children,
    );
  }

  const text = typeof children === "string" ? children : "";

  return (
    <div {...props} className={clsx(className, styles.markdown)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
