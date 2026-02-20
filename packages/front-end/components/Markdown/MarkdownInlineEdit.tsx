import { useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import { computeAIUsageData } from "shared/ai";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
import OptInModal from "@/components/License/OptInModal";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import track from "@/services/track";
import Markdown from "./Markdown";
import MarkdownInput from "./MarkdownInput";

type Props = {
  value: string;
  save: (text: string) => Promise<void>;
  canEdit?: boolean;
  canCreate?: boolean;
  label?: string;
  className?: string;
  containerClassName?: string;
  header?: string | JSX.Element;
  headerClassName?: string;
  emptyHelperText?: string;
  aiSuggestFunction?: () => Promise<string>;
  aiButtonText?: string;
  aiSuggestionHeader?: string;
};

export default function MarkdownInlineEdit({
  value,
  save,
  canEdit = true,
  canCreate = true,
  label = "description",
  className = "",
  containerClassName = "",
  header = "",
  headerClassName = "h3",
  emptyHelperText,
  aiSuggestFunction,
  aiButtonText = "Get AI Suggestion",
  aiSuggestionHeader = "Suggestion",
}: Props) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiAgreementModal, setAiAgreementModal] = useState(false);
  const aiSuggestionRef = useRef<string | undefined>(undefined);
  const { aiAgreedTo, aiEnabled } = useAISettings();
  const { hasCommercialFeature } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");

  if (edit) {
    return (
      <form
        className={"position-relative" + " " + className}
        onSubmit={async (e) => {
          e.preventDefault();
          if (loading) return;
          setError(null);
          setLoading(true);
          try {
            await save(val);
            if (aiSuggestFunction) {
              const aiUsageData = computeAIUsageData({
                value: val,
                aiSuggestionText: aiSuggestionRef.current,
              });
              track("Inline Edit Save", {
                label,
                aiUsageData,
              });
            }
            setEdit(false);
          } catch (e) {
            setError(e.message);
          }
          setLoading(false);
        }}
      >
        {header && (
          <Flex align={"center"} justify="between">
            <div className={headerClassName}>{header}</div>{" "}
            {aiSuggestFunction && (
              <Flex gap="2">
                <div className="col-auto">
                  <button
                    className="btn btn-link mr-2 ml-3"
                    onClick={(e) => {
                      e.preventDefault();
                      setEdit(false);
                    }}
                  >
                    cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Save
                  </button>
                </div>
              </Flex>
            )}
          </Flex>
        )}
        {loading && <LoadingOverlay />}
        <MarkdownInput
          value={val}
          setValue={setVal}
          cta={"Save"}
          error={error ?? undefined}
          autofocus={true}
          onCancel={() => setEdit(false)}
          aiSuggestFunction={aiSuggestFunction}
          aiButtonText={aiButtonText}
          aiSuggestionHeader={aiSuggestionHeader}
          showButtons={!aiSuggestFunction}
          onAISuggestionReceived={(result) => {
            aiSuggestionRef.current = result;
          }}
        />
      </form>
    );
  }

  return (
    <Box className={className} style={{ position: "relative" }}>
      {loading && (
        <LoadingOverlay
          text={aiSuggestFunction ? "Generating..." : "Loading..."}
        />
      )}
      {header && (
        <HeaderWithEdit
          edit={
            canEdit
              ? () => {
                  setVal(value || "");
                  setEdit(true);
                }
              : undefined
          }
          className={headerClassName}
          containerClassName={containerClassName}
        >
          {header}
        </HeaderWithEdit>
      )}
      <Flex align="start" justify="between" gap="4">
        <Box className="" flexGrow="1">
          {value ? (
            <Markdown className="card-text">{value}</Markdown>
          ) : (
            <Box className="card-text">
              {canCreate ? (
                <>
                  <Box pt={"3"}>
                    {emptyHelperText ? (
                      <em>{emptyHelperText}</em>
                    ) : (
                      <a
                        role="button"
                        className="link-purple"
                        onClick={(e) => {
                          e.preventDefault();
                          setVal(value || "");
                          setEdit(true);
                        }}
                      >
                        <em>Add {label}</em>
                      </a>
                    )}
                  </Box>
                  {aiSuggestFunction && (
                    <Box pt={"5"} className="d-inline-block">
                      {!hasAISuggestions ? (
                        <PremiumTooltip commercialFeature="ai-suggestions">
                          <Button variant="soft" disabled={true}>
                            {aiButtonText}
                          </Button>
                        </PremiumTooltip>
                      ) : (
                        <Button
                          variant="soft"
                          onClick={async () => {
                            if (!aiAgreedTo) {
                              setAiAgreementModal(true);
                            } else if (!aiEnabled) {
                              setError(
                                "AI suggestions are not enabled for your organization. Enable it in settings.",
                              );
                              setEdit(true); // Error is only shown in edit mode
                            } else {
                              setError(null);
                              setLoading(true);
                              try {
                                const suggestion = await aiSuggestFunction();
                                if (suggestion) {
                                  aiSuggestionRef.current = suggestion;
                                  setVal(suggestion);
                                }
                                setLoading(false);
                                setEdit(true);
                              } catch (e) {
                                setLoading(false);
                                setError(e.message);
                                setEdit(true); // Error is only shown in edit mode
                              }
                            }
                          }}
                        >
                          {aiButtonText} <BsStars />
                        </Button>
                      )}
                    </Box>
                  )}
                </>
              ) : (
                <em>No {label}</em>
              )}
            </Box>
          )}
        </Box>
        {value && canEdit && !header && (
          <Box className="">
            <a
              role="button"
              className="link-purple"
              onClick={(e) => {
                e.preventDefault();
                setVal(value || "");
                setEdit(true);
              }}
            >
              <Button variant="ghost">Edit</Button>
            </a>
          </Box>
        )}
      </Flex>
      {aiAgreementModal && (
        <OptInModal agreement="ai" onClose={() => setAiAgreementModal(false)} />
      )}
    </Box>
  );
}
