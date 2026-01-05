import { useRouter } from "next/router";
import { useMemo } from "react";
import { FeatureCodeRefsInterface } from "shared/types/code-refs";
import { OrganizationSettings } from "shared/types/organization";
import { FaGitAlt, FaExternalLinkAlt } from "react-icons/fa";
import Code from "@/components/SyntaxHighlighting/Code";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumEmptyState from "@/components/PremiumEmptyState";

const generatePlatformUrl = (
  platformUrl: string,
  repo: string,
  branch: string,
  filePath: string,
  lineNumber: number,
) => {
  return `${platformUrl}/${repo}/blob/${branch}/${filePath}#L${lineNumber}`;
};

export default function FeaturesStats({
  orgSettings,
  codeRefs: allCodeRefs,
}: {
  orgSettings: OrganizationSettings;
  codeRefs: FeatureCodeRefsInterface[];
}) {
  const router = useRouter();
  const {
    codeReferencesEnabled,
    codeRefsPlatformUrl,
    codeRefsBranchesToFilter,
  } = orgSettings;
  const { hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("code-references");
  const permissionsUtil = usePermissionsUtil();

  const codeRefs = useMemo(() => {
    if (!codeRefsBranchesToFilter || codeRefsBranchesToFilter.length === 0) {
      return allCodeRefs;
    }
    return allCodeRefs.filter((codeRef) =>
      codeRefsBranchesToFilter.includes(codeRef.branch),
    );
  }, [allCodeRefs, codeRefsBranchesToFilter]);

  if (!hasFeature) {
    return (
      <>
        <div className="contents container-fluid pagecontents">
          <PremiumEmptyState
            title="Enable Code References"
            description="Quickly see instances of feature flags being leveraged in your
              codebase, with direct links from GrowthBook to the platform of
              your choice."
            commercialFeature="code-references"
            learnMoreLink="https://docs.growthbook.io/features/code-references"
          />
        </div>
      </>
    );
  }
  if (!codeReferencesEnabled) {
    return (
      <>
        <div className="contents container-fluid pagecontents">
          <div
            className="appbox"
            style={{
              height: "18rem",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <h2 className="m-0 ml-1">Enable Code References</h2>
            <p style={{ width: "32rem" }}>
              Quickly see instances of feature flags being leveraged in your
              codebase, with direct links from GrowthBook to the platform of
              your choice.
            </p>

            <Tooltip
              shouldDisplay={!permissionsUtil.canManageOrgSettings()}
              body="You need permission to manage organization settings to enable this feature."
            >
              <Button
                disabled={!permissionsUtil.canManageOrgSettings()}
                onClick={async () => {
                  router.push("/settings#configure-code-refs");
                }}
              >
                Go to settings
              </Button>
            </Tooltip>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="contents container-fluid pagecontents">
      <h3>Code References</h3>
      <div className="mb-1">
        References to this feature flag found in your codebase.
      </div>
      {codeRefs.length > 0 ? (
        codeRefs.map((codeRef, i) => (
          <div key={i} className="appbox mb-4 p-3">
            <div className="row mx-1 d-flex align-items-center">
              <FaGitAlt />
              <div className="mx-2">{codeRef.repo} </div>
              <div className="mr-2">•</div>
              <div>
                {codeRef.refs.length} reference(s) found in{" "}
                <code>{codeRef.branch}</code> branch.
              </div>
            </div>
            <div className="d-flex flex-column">
              {codeRef.refs.map((ref, i) => (
                <div key={i} className="my-2 p-2">
                  <div className="px-1">
                    {codeRefsPlatformUrl && (
                      <a
                        href={generatePlatformUrl(
                          codeRefsPlatformUrl,
                          codeRef.repo,
                          codeRef.branch,
                          ref.filePath,
                          ref.startingLineNumber +
                            ((ref.lines.split("\n").length / 2) | 0),
                        )}
                      >
                        <FaExternalLinkAlt className="mr-2 cursor-pointer" />
                      </a>
                    )}
                    <code>{ref.filePath}</code>
                  </div>
                  <Code
                    language="tsx"
                    code={ref.lines}
                    highlightLine={
                      ref.startingLineNumber +
                      ((ref.lines.split("\n").length / 2) | 0)
                    }
                    expandable={true}
                    startingLineNumber={ref.startingLineNumber}
                  />
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="appbox p-3">No code references found.</div>
      )}
    </div>
  );
}
