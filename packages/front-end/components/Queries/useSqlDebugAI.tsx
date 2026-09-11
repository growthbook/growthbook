import { type ReactNode, useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { BsStars } from "react-icons/bs";
import { PiCheck, PiCopy, PiX } from "react-icons/pi";
import { formatAIRateLimitRetryMessage } from "shared/ai";
import type {
  SqlDebugContext,
  SqlDebugQueryKind,
  SqlDebugResponse,
} from "shared/sql-debug";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import Markdown from "@/components/Markdown/Markdown";

export type SqlDebugAIConfig = {
  datasourceId: string;
  queryKind: SqlDebugQueryKind;
  sourceSql: string;
  context?: SqlDebugContext;
  onApplySql?: (sql: string) => void;
  onApplyAndRun?: (sql: string) => void | Promise<void>;
};

/**
 * Splits the trigger from the result so the CTA can live inside the error
 * callout while the diff renders below it.
 */
export default function useSqlDebugAI({
  error,
  config,
}: {
  error: string;
  config?: SqlDebugAIConfig;
}): { trigger: ReactNode; panel: ReactNode } {
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const { theme } = useAppearanceUITheme();
  const { performCopy, copySuccess } = useCopyToClipboard({ timeout: 1000 });
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [result, setResult] = useState<SqlDebugResponse | null>(null);

  const sourceSql = config?.sourceSql;
  useEffect(() => {
    setResult(null);
    setRequestError(null);
  }, [sourceSql, error]);

  if (
    !config ||
    !aiEnabled ||
    !aiAgreedTo ||
    !hasCommercialFeature("ai-suggestions")
  ) {
    return { trigger: null, panel: null };
  }

  const fixQuery = async () => {
    setLoading(true);
    setRequestError(null);
    setResult(null);
    try {
      const response = await apiCall<{ data: SqlDebugResponse }>(
        "/ai/debug-sql",
        {
          method: "POST",
          body: JSON.stringify({
            datasourceId: config.datasourceId,
            sql: config.sourceSql,
            error,
            queryKind: config.queryKind,
            context: config.context,
          }),
        },
        (responseData) => {
          if (responseData.status === 429) {
            setRequestError(
              formatAIRateLimitRetryMessage(responseData.retryAfter),
            );
          } else {
            setRequestError(
              responseData.message || "Unable to analyze this query.",
            );
          }
        },
      );
      setResult(response.data);
    } catch (caught) {
      setRequestError((current) =>
        current
          ? current
          : caught instanceof Error
            ? caught.message
            : "Unable to analyze this query.",
      );
    } finally {
      setLoading(false);
    }
  };

  const trigger = result ? null : (
    <Button
      size="md"
      color="inherit"
      icon={<BsStars />}
      loading={loading}
      variant="outline"
      onClick={() => void fixQuery()}
    >
      Fix Query
    </Button>
  );

  const suggestedSql = result?.suggestedSql ?? null;

  const panel =
    !result && !requestError ? null : (
      <Box mt="3">
        {requestError ? (
          <Callout
            status="error"
            action={
              <Button
                size="sm"
                variant="ghost"
                color="inherit"
                onClick={() => setRequestError(null)}
              >
                Dismiss
              </Button>
            }
          >
            {requestError}
          </Callout>
        ) : result ? (
          <Flex direction="column" gap="3">
            <Box>
              <Text as="div" weight="medium">
                {result.likelyCause}
              </Text>
              <Markdown>{result.explanation}</Markdown>
            </Box>
            {suggestedSql ? (
              <>
                {result.fixSummary ? (
                  <Text size="sm">{result.fixSummary}</Text>
                ) : null}
                <Box
                  style={{
                    maxHeight: 360,
                    overflow: "auto",
                    border: "1px solid var(--gray-a4)",
                    borderRadius: "var(--radius-3)",
                  }}
                >
                  <ReactDiffViewer
                    oldValue={config.sourceSql}
                    newValue={suggestedSql}
                    compareMethod={DiffMethod.LINES}
                    splitView={false}
                    useDarkTheme={theme === "dark"}
                    leftTitle="Current SQL"
                    rightTitle="Suggested SQL"
                    styles={{
                      contentText: {
                        fontFamily: "var(--code-font-family)",
                        fontSize: 12,
                        wordBreak: "break-word",
                      },
                    }}
                  />
                </Box>
                <Flex gap="2" wrap="wrap">
                  {config.onApplySql ? (
                    <Button
                      size="sm"
                      icon={<PiCheck />}
                      onClick={() => {
                        config.onApplySql?.(suggestedSql);
                        setResult(null);
                      }}
                    >
                      Apply
                    </Button>
                  ) : null}
                  {config.onApplyAndRun ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await config.onApplyAndRun?.(suggestedSql);
                        setResult(null);
                      }}
                    >
                      Apply and run
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={copySuccess ? <PiCheck /> : <PiCopy />}
                    onClick={() => performCopy(suggestedSql)}
                  >
                    {copySuccess ? "Copied" : "Copy suggested SQL"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    color="gray"
                    icon={<PiX />}
                    onClick={() => setResult(null)}
                  >
                    Dismiss
                  </Button>
                </Flex>
              </>
            ) : (
              <Flex>
                <Button
                  size="sm"
                  variant="ghost"
                  color="gray"
                  icon={<PiX />}
                  onClick={() => setResult(null)}
                >
                  Dismiss
                </Button>
              </Flex>
            )}
          </Flex>
        ) : null}
      </Box>
    );

  return { trigger, panel };
}
