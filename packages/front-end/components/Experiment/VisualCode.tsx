import { DomChange } from "back-end/types/experiment";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow as theme } from "react-syntax-highlighter/dist/cjs/styles/prism";
import stringify from "json-stringify-pretty-compact";
import { useState } from "react";
import { FaCaretDown, FaCaretRight, FaCode } from "react-icons/fa";

export default function VisualCode({
  dom,
  css,
}: {
  dom: DomChange[];
  css: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-2 text-left">
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <FaCode /> {open ? "hide code" : "show code"}
        {open ? <FaCaretDown /> : <FaCaretRight />}
      </a>
      {open && (
        <div style={{ marginTop: -8 }}>
          <SyntaxHighlighter language="json" style={theme}>
            {stringify(
              {
                mutations: dom.map((d) => [
                  d.selector,
                  d.action + " " + d.attribute,
                  d.value,
                ]),
                css: css || "",
              },
              {
                maxLength: 50,
              }
            )}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}
