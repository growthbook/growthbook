import {
  DomChange,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import stringify from "json-stringify-pretty-compact";
import { useState } from "react";
import { FaCaretDown, FaCaretRight, FaCode } from "react-icons/fa";
import usePermissions from "@/hooks/usePermissions";
import Code from "../SyntaxHighlighting/Code";
import OpenVisualEditorLink from "../OpenVisualEditorLink";

export default function VisualCode({
  dom,
  css,
  control = false,
  experiment,
  openSettings,
}: {
  dom: DomChange[];
  css: string;
  control?: boolean;
  experiment: ExperimentInterfaceStringDates;
  openSettings?: () => void;
}) {
  const permissions = usePermissions();

  const [open, setOpen] = useState(false);

  const hasCode = dom.length > 0 || css.length > 0;

  if (!hasCode && permissions.check("createAnalyses", "")) {
    return control ? null : (
      <div className="alert alert-warning my-2">
        No visual changes yet.{" "}
        <OpenVisualEditorLink
          visualEditorUrl={experiment.visualEditorUrl}
          experimentId={experiment.id}
          openSettings={openSettings}
        />
      </div>
    );
  }

  return (
    <div className="my-2">
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
          <Code
            language="json"
            code={stringify(
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
          />
        </div>
      )}
    </div>
  );
}
