import React from "react";
import Handlebars from "handlebars";
import Markdown from "./Markdown";

interface Props {
  markdown?: string;
  handlebarsVariables: Record<string, any>;
}

const CustomMarkdown: React.FC<Props> = ({ markdown, handlebarsVariables }) => {
  if (!markdown) return null;

  const template = Handlebars.compile(markdown);
  const renderedMarkdown = template(handlebarsVariables);

  return (
    <div className="alert alert-info">
      <Markdown>{renderedMarkdown}</Markdown>
    </div>
  );
};

export default CustomMarkdown;
