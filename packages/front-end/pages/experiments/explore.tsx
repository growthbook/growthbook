import React, { useCallback, useMemo, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useForm } from "react-hook-form"; // Adjust the import path based on your project structure
import { debounce } from "lodash";
import { FaExternalLinkAlt } from "react-icons/fa";
import { date } from "shared/dates";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import { useExperimentSearch } from "@/services/experiments";
import { useAISettings } from "@/hooks/useOrgSettings";
import Link from "@/components/Radix/Link";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Markdown from "@/components/Markdown/Markdown";
import ExperimentSearchFilters from "@/components/Search/ExperimentSearchFilters";
import LoadingOverlay from "@/components/LoadingOverlay";

const SearchExperimentsPage: React.FC = () => {
  const { apiCall } = useAuth();
  const { aiEnabled } = useAISettings();
  const [results, setResults] = useState<
    { experiment: ExperimentInterfaceStringDates; similarity: number }[]
  >([]);
  const hypothesisTimeout = useRef<NodeJS.Timeout | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const form = useForm({
    defaultValues: {
      searchTerm: "",
    },
  });
  // extract all experiments from the results:
  const allSimilarExperiments = results.map((result) => result.experiment);
  const {
    filteredItems,
    syntaxFilters,
    searchInputProps,
    setSearchValue,
  } = useExperimentSearch({
    allExperiments: allSimilarExperiments,
  });

  const checkForSimilar = useCallback(async () => {
    if (!aiEnabled) {
      setError("AI features are not enabled");
      return;
    }
    if (hypothesisTimeout.current) {
      clearTimeout(hypothesisTimeout.current);
    }
    const searchTerm = form.getValues("searchTerm");
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError("");
    try {
      const response = await apiCall<{
        status: number;
        message?: string;
        similar?: {
          experiment: ExperimentInterfaceStringDates;
          similarity: number;
        }[];
      }>(
        `/experiments/similar`,
        {
          method: "POST",
          body: JSON.stringify({ name: searchTerm, full: true }),
        },
        (responseData) => {
          if (responseData.status === 429) {
            const retryAfter = parseInt(responseData.retryAfter);
            const hours = Math.floor(retryAfter / 3600);
            const minutes = Math.floor((retryAfter % 3600) / 60);
            setError(
              `You have reached the request limit for search. Try again in ${hours} hours and ${minutes} minutes.`
            );
          } else {
            console.error(
              "Error fetching similar experiments:",
              responseData.message
            );
            setError("Error fetching similar experiments");
          }
        }
      );

      if (response?.status === 200 && response.similar?.length) {
        setResults(response.similar);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error("Error fetching experiments:", err);
      setError("Failed to fetch experiments. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [aiEnabled, apiCall, form]);
  const queueCheckForSimilar = useMemo(
    () =>
      debounce(async () => {
        try {
          await checkForSimilar();
        } catch (error) {
          console.error("Error in checkForSimilar:", error);
        }
      }, 300),
    [checkForSimilar]
  );

  return (
    <Box className="contents experiments container-fluid pagecontents">
      <Heading>Search Similar Experiments</Heading>
      <p>Use semantic search to find experiments related to a term or theme</p>
      {aiEnabled ? (
        <>
          <Flex gap="4" mb="4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (loading) return;
                setError("");
                setLoading(true);
                try {
                  await checkForSimilar();
                } catch (e) {
                  setError(e.message);
                }
                setLoading(false);
              }}
            >
              <Box width="300px">
                <Field
                  placeholder="Search..."
                  type="search"
                  autoFocus
                  {...form.register("searchTerm", {
                    onChange: () => {
                      queueCheckForSimilar(); // Debounced call
                    },
                  })}
                />
              </Box>
            </form>
            <ExperimentSearchFilters
              searchInputProps={searchInputProps}
              syntaxFilters={syntaxFilters}
              setSearchValue={setSearchValue}
              experiments={allSimilarExperiments}
            />
          </Flex>
          {error && <p className="alert alert-danger">{error}</p>}
          <Box className="results" style={{ position: "relative" }}>
            {filteredItems.length > 0 ? (
              <>
                {filteredItems.map((e, i) => (
                  <Box
                    key={`similar-${i}`}
                    mb="2"
                    className="appbox"
                    p="3"
                    style={{
                      maxHeight: "350px",
                      overflowY: "auto",
                      color: "var(--text-color-main)",
                    }}
                  >
                    <Flex direction="column" gap="3" justify="start">
                      <Flex gap="3" justify="between">
                        <Flex gap="3" align="start">
                          <Link
                            href="/experiment/[id]"
                            as={`/experiment/${e.id}`}
                            target="_blank"
                          >
                            <Heading size="2">{e.name}</Heading>
                          </Link>
                          <span style={{ fontSize: "0.8rem" }}>
                            <FaExternalLinkAlt />
                          </span>
                        </Flex>
                        <Flex gap="3" align="center">
                          <Text size="1" className="text-muted">
                            {date(e.dateCreated)}
                          </Text>
                          <ExperimentStatusIndicator experimentData={e} />
                        </Flex>
                      </Flex>
                      {e.description && (
                        <Box style={{ fontSize: "0.9em" }}>
                          <strong>Description:</strong>{" "}
                          <Markdown>{e.description}</Markdown>
                        </Box>
                      )}
                      <Box style={{ fontSize: "0.9em" }}>
                        <strong>Hypothesis:</strong>{" "}
                        <Markdown>{e.hypothesis}</Markdown>
                      </Box>
                    </Flex>
                  </Box>
                ))}
              </>
            ) : (
              !loading &&
              form.watch("searchTerm") !== "" && (
                <p>No related experiments found.</p>
              )
            )}
            {loading && (
              <Flex
                align="center"
                justify="center"
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                }}
              >
                <LoadingOverlay />
              </Flex>
            )}
          </Box>
        </>
      ) : (
        <p>
          AI features are not enabled for your organization. You can enable them
          from Settings -&gt; General -&gt; AI Settings
        </p>
      )}
    </Box>
  );
};

export default SearchExperimentsPage;
