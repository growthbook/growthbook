import { FeatureCodeRefsInterface } from "back-end/types/code-refs";
import { FaGithub, FaExternalLinkAlt } from "react-icons/fa";
import Code from "@/components/SyntaxHighlighting/Code";

export default function FeaturesStats({
  codeRefs,
}: {
  codeRefs: FeatureCodeRefsInterface[];
}) {
  return (
    <div className="contents container-fluid pagecontents">
      {codeRefs.length > 0 && (
        <>
          <h3>Code References</h3>
          <div className="mb-1">
            References to this feature flag found in your codebase.
          </div>
          <div className="appbox mb-4 p-3">
            {codeRefs.map((codeRef, i) => (
              <div key={i}>
                <div className="row mx-1 d-flex align-items-center" style={{}}>
                  <FaGithub />
                  <div className="mx-2">{codeRef.repo} </div>
                  <div className="mr-2">•</div>
                  <div>
                    {codeRef.refs.length} reference(s) found in{" "}
                    <code>{codeRef.branch}</code> branch.
                  </div>
                </div>
                <div className="d-flex flex-column ">
                  {codeRef.refs.map((ref, i) => (
                    <div key={i} className="appbox my-2 p-2">
                      <div className="px-1">
                        <a href="#">
                          <FaExternalLinkAlt className="mr-2 cursor-pointer" />
                        </a>
                        <code>{ref.filePath}</code>
                      </div>
                      <Code
                        language="tsx"
                        code={ref.lines}
                        expandable={true}
                        highlightLine={ref.startingLineNumber + 2}
                        startingLineNumber={ref.startingLineNumber}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
