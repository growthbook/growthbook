import { useRouter } from "next/router";
import { useMemo } from "react";
import { FeatureCodeRefsInterface } from "shared/types/code-refs";
import { OrganizationSettings } from "shared/types/organization";
import { FaGitAlt, FaExternalLinkAlt } from "react-icons/fa";
import { Flex, Box } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import Code from "@/components/SyntaxHighlighting/Code";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import PremiumEmptyState from "@/components/PremiumEmptyState";
import LoadingOverlay from "@/components/LoadingOverlay";
import Callout from "@/ui/Callout";
import useApi from "@/hooks/useApi";

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
  featureId,
}: {
  orgSettings: OrganizationSettings;
  featureId: string;
}) {
  const { t } = useLingui();
  const router = useRouter();
  const {
    codeReferencesEnabled,
    codeRefsPlatformUrl,
    codeRefsBranchesToFilter,
  } = orgSettings;
  const { hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("code-references");
  const permissionsUtil = usePermissionsUtil();

  const { data, error } = useApi<{ codeRefs: FeatureCodeRefsInterface[] }>(
    `/feature/${featureId}/code-refs`,
    { shouldRun: () => hasFeature && !!codeReferencesEnabled },
  );
  const allCodeRefs = useMemo(() => data?.codeRefs ?? [], [data]);

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
            title={t`Enable Code References`}
            description={t`Quickly see instances of feature flags being leveraged in your codebase, with direct links from GrowthBook to the platform of your choice.`}
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
            <h2 className="m-0 ml-1">
              <Trans>Enable Code References</Trans>
            </h2>
            <p style={{ width: "32rem" }}>
              <Trans>
                Quickly see instances of feature flags being leveraged in your
                codebase, with direct links from GrowthBook to the platform of
                your choice.
              </Trans>
            </p>

            <Tooltip
              shouldDisplay={!permissionsUtil.canManageOrgSettings()}
              body={t`You need permission to manage organization settings to enable this feature.`}
            >
              <Button
                disabled={!permissionsUtil.canManageOrgSettings()}
                onClick={async () => {
                  router.push("/settings#configure-code-refs");
                }}
              >
                <Trans>Go to settings</Trans>
              </Button>
            </Tooltip>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <div className="contents container-fluid pagecontents">
        <Callout status="error" mt="4">
          <Trans>Failed to load code references.</Trans>
        </Callout>
      </div>
    );
  }
  if (!data) return <LoadingOverlay />;

  return (
    <div className="contents container-fluid pagecontents">
      <Flex align="start" justify="between" mt="4" mb="5" gap="4">
        <Box flexShrink="1">
          <Heading mb="1" size="md" as="h3">
            <Trans>Code References</Trans>
          </Heading>
          <Text mb="0">
            <Trans>
              References to this feature flag found in your codebase.
            </Trans>
          </Text>
        </Box>
      </Flex>
      {codeRefs.length > 0 ? (
        codeRefs.map((codeRef, i) => {
          const refCount = codeRef.refs.length;
          const branch = codeRef.branch;
          return (
            <div key={i} className="appbox mb-4 p-3">
              <div className="row mx-1 d-flex align-items-center">
                <FaGitAlt />
                <div className="mx-2">{codeRef.repo} </div>
                <div className="mr-2">•</div>
                <div>
                  <Trans>
                    {refCount} reference(s) found in <code>{branch}</code>{" "}
                    branch.
                  </Trans>
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
          );
        })
      ) : (
        <div className="appbox p-3">
          <Trans>No code references found.</Trans>
        </div>
      )}
    </div>
  );
}
