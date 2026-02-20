import {
  DetailedHTMLProps,
  FC,
  HTMLAttributes,
  useEffect,
  useRef,
  useState,
} from "react";
import { BsStars } from "react-icons/bs";
import { FaMarkdown } from "react-icons/fa";
import ReactTextareaAutocomplete from "@webscopeio/react-textarea-autocomplete";
import emoji from "@jukben/emoji-search";
import { useDropzone } from "react-dropzone";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { uploadFile } from "@/services/files";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/ui/Button";
import useOrgSettings, { useAISettings } from "@/hooks/useOrgSettings";
import OptInModal from "@/components/License/OptInModal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import track from "@/services/track";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Markdown from "./Markdown";

const Item = ({ entity: { name, char } }) => <div>{`${name}: ${char}`}</div>;
const Loading = () => <div>Loading</div>;

//Extracts a human-readable link label from a URL for Markdown link shorthand.
function getLinkLabelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Link";
  } catch {
    return "Link";
  }
}
const MarkdownInput: FC<{
  value: string;
  setValue: (value: string) => void;
  autofocus?: boolean;
  error?: string;
  cta?: string;
  id?: string;
  placeholder?: string;
  aiSuggestFunction?: () => Promise<string>;
  aiButtonText?: string;
  aiSuggestionHeader?: string;
  onOptInModalOpen?: () => void;
  onOptInModalClose?: () => void;
  onCancel?: () => void;
  hidePreview?: boolean;
  showButtons?: boolean;
  onAISuggestionReceived?: (result: string) => void;
  trackingSource?: string;
}> = ({
  value,
  setValue,
  autofocus = false,
  error: externalError,
  cta,
  id,
  onCancel,
  placeholder,
  hidePreview,
  aiSuggestFunction,
  aiButtonText = "Get AI Suggestion",
  aiSuggestionHeader = "Suggestion",
  onOptInModalOpen, // If this component is in Modal itself this can be used to close that modal when the OptInModal opens
  onOptInModalClose, // ... And this can be used to open that modal when the OptInModal closes
  showButtons = true,
  onAISuggestionReceived,
  trackingSource,
}) => {
  const { aiEnabled, aiAgreedTo } = useAISettings();
  const [activeControlledTab, setActiveControlledTab] = useState<
    "write" | "preview"
  >("write");
  const { apiCall } = useAuth();
  const textareaRef = useRef<null | HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [aiSuggestionText, setAiSuggestionText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(externalError || "");
  const [revertValue, setRevertValue] = useState<string | null>(null);
  const { hasCommercialFeature } = useUser();
  const hasAISuggestions = hasCommercialFeature("ai-suggestions");
  const { blockFileUploads } = useOrgSettings();

  const [aiAgreementModal, setAiAgreementModal] = useState(false);
  useEffect(() => {
    if (autofocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autofocus, textareaRef.current]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text/plain").trim();
    if (!pasted || !/^https?:\/\/\S+$/i.test(pasted)) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    e.preventDefault();

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const selectedText = value.slice(start, end).trim();
    const linkLabel =
      start !== end && selectedText
        ? selectedText
        : getLinkLabelFromUrl(pasted);
    const markdownLink = `[${linkLabel}](<${pasted}>)`;
    const newValue = value.slice(0, start) + markdownLink + value.slice(end);
    setValue(newValue);

    const cursorAfterInsert = start + markdownLink.length;
    // Defer so React can commit the new value to the DOM first; otherwise
    // setSelectionRange runs against the old value and may be overwritten.
    setTimeout(() => {
      textarea.setSelectionRange(cursorAfterInsert, cursorAfterInsert);
      textarea.focus();
    }, 0);
  };

  const onDrop = (files: File[]) => {
    if (blockFileUploads) return;

    setUploading(true);
    const toAdd: string[] = [];
    const promises = Promise.all(
      files.map(async (file, i) => {
        const name = file.name.replace(/[^a-zA-Z0-9_\-.\s]*/g, "");

        const { fileURL } = await uploadFile(apiCall, file);

        toAdd[i] = `![${name}](${fileURL})`;
      }),
    );

    promises
      .then(() => {
        setValue(value + toAdd.join("\n") + "\n");
        setUploading(false);
      })
      .catch((e) => {
        alert("Failed to upload image: " + e);
        setUploading(false);
      });
  };
  const { getRootProps, getInputProps, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    accept: "image/png, image/jpeg, image/gif",
  });

  // getRootProps assumes generic HTMLElement, but we're using HTMLDivElement
  const rootProps: unknown = getRootProps();
  const typedRootProps = rootProps as DetailedHTMLProps<
    HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;

  const doAISuggestion = async () => {
    if (aiSuggestFunction && aiEnabled) {
      track("AI Usage", { source: trackingSource });
      setError("");
      try {
        setLoading(true);
        // make sure it's on the right tab:
        setActiveControlledTab("write");
        const suggestedText = await aiSuggestFunction();
        if (suggestedText) {
          if (onAISuggestionReceived) {
            onAISuggestionReceived(suggestedText);
          }
          if (!value || !value.trim()) {
            setValue(suggestedText);
          } else {
            setAiSuggestionText(suggestedText);
          }
          setLoading(false);
        } else {
          setLoading(false);
          setError("Failed to get AI suggestion");
        }
      } catch (e) {
        setLoading(false);
        if (e.message) {
          setError(e.message);
        } else {
          setError("Failed to get AI suggestion. API request error");
        }
      }
    } else {
      setError("AI is disabled for your organization. Adjust in settings.");
    }
  };

  return (
    <Box className="">
      {loading && <LoadingOverlay text="Generating..." />}
      <Tabs
        value={activeControlledTab}
        onValueChange={(tab) =>
          setActiveControlledTab(tab === "write" ? "write" : "preview")
        }
      >
        {!hidePreview && (
          <Flex align="center" justify="between">
            <TabsList>
              <TabsTrigger value="write">Write</TabsTrigger>
              <TabsTrigger value="preview" disabled={!value}>
                Preview
              </TabsTrigger>
            </TabsList>
          </Flex>
        )}
        <Box pt="2">
          <TabsContent value="write">
            <div className="position-relative" {...typedRootProps}>
              <ReactTextareaAutocomplete
                className="form-control mb-1"
                rows={6}
                loadingComponent={Loading}
                minChar={0}
                dropdownStyle={{
                  position: "absolute",
                  maxHeight: 100,
                  overflowY: "auto",
                }}
                id={id}
                innerRef={(textarea) => {
                  textareaRef.current = textarea;
                }}
                style={{
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                }}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                }}
                onPaste={handlePaste}
                placeholder={placeholder}
                trigger={{
                  ":": {
                    dataProvider: (token) => {
                      return emoji(token)
                        .slice(0, 10)
                        .map(({ name, char }) => ({ name, char }));
                    },
                    component: Item,
                    output: (item) => item.char,
                  },
                }}
              />

              {uploading && <LoadingOverlay />}
              {!blockFileUploads && (
                <>
                  <input {...getInputProps()} />
                  <div className="cursor-pointer py-1 px-2 border rounded-bottom mb-2 bg-light">
                    <a
                      href="https://guides.github.com/features/mastering-markdown/"
                      target="_blank"
                      rel="noreferrer"
                      className="text-dark float-right"
                      style={{
                        fontSize: "1.2em",
                        lineHeight: "1em",
                      }}
                      title="Github-flavored Markdown is supported"
                    >
                      <FaMarkdown />
                    </a>
                    <div className="small text-muted" onClick={open}>
                      Upload images by dragging &amp; dropping or clicking
                      here{" "}
                    </div>
                  </div>
                </>
              )}
            </div>
            {showButtons && (
              <div className="row">
                {error ? (
                  <div className="col-auto">
                    <span className="text-danger">{error}</span>
                  </div>
                ) : (
                  ""
                )}
                <div style={{ flex: 1 }} />

                <div className="col-auto">
                  {onCancel && (
                    <button
                      className="btn btn-link mr-2 ml-3"
                      onClick={(e) => {
                        e.preventDefault();
                        onCancel();
                      }}
                    >
                      cancel
                    </button>
                  )}
                  {cta && (
                    <button type="submit" className="btn btn-primary">
                      {cta}
                    </button>
                  )}
                </div>
              </div>
            )}
            {aiSuggestFunction && !aiSuggestionText && (
              <Flex pt={"5"}>
                {!hasAISuggestions ? (
                  <PremiumTooltip commercialFeature="ai-suggestions">
                    <Button variant="soft" disabled={true}>
                      {" "}
                      <BsStars /> {aiButtonText}
                    </Button>
                  </PremiumTooltip>
                ) : aiAgreedTo && aiEnabled ? (
                  <Button
                    variant="soft"
                    disabled={loading}
                    onClick={doAISuggestion}
                  >
                    <BsStars /> {loading ? "Generating..." : aiButtonText}
                  </Button>
                ) : (
                  <Tooltip
                    body={
                      !aiEnabled
                        ? "AI is disabled for your organization. Adjust in settings."
                        : ""
                    }
                  >
                    <Button
                      variant="soft"
                      onClick={() => {
                        if (!aiAgreedTo) {
                          setAiAgreementModal(true);
                          if (onOptInModalOpen) {
                            // Needs a timeout to avoid a flicker when the parent modal disappears and the OptInModal appears
                            // This makes sure the OptInModal shows slightly before the parent modal and its backdrop disappears.
                            setTimeout(() => {
                              onOptInModalOpen();
                            }, 0);
                          }
                        } else {
                          setError(
                            "AI is disabled for your organization. Adjust in settings.",
                          );
                        }
                      }}
                    >
                      <BsStars /> {aiButtonText}
                    </Button>
                  </Tooltip>
                )}
              </Flex>
            )}
            {aiSuggestionText && (
              <div className="mt-2">
                <Flex align="center" justify="between" my="4">
                  <Heading size="2" weight="medium">
                    {aiSuggestionHeader}:
                  </Heading>
                  <Flex gap="2">
                    <Button variant="ghost" onClick={doAISuggestion}>
                      <PiArrowClockwise /> Try Again
                    </Button>
                    {aiSuggestionText && value != aiSuggestionText && (
                      <Tooltip body="Overwrite content above with suggested content.">
                        <Button
                          variant="soft"
                          onClick={() => {
                            setRevertValue(value);
                            setValue(aiSuggestionText);
                          }}
                        >
                          Use Suggested
                        </Button>
                      </Tooltip>
                    )}
                    {revertValue && value == aiSuggestionText && (
                      <Tooltip body="Revert to previous content.">
                        <Button
                          variant="soft"
                          onClick={() => {
                            setValue(revertValue);
                            setRevertValue(null);
                          }}
                        >
                          Revert
                        </Button>
                      </Tooltip>
                    )}
                  </Flex>
                </Flex>
                <Box className="appbox" p="3">
                  <Markdown className="card-text mb-2">
                    {aiSuggestionText}
                  </Markdown>
                </Box>
              </div>
            )}
            {!showButtons && error && (
              <div className="alert alert-danger mt-2">{error}</div>
            )}
          </TabsContent>
          <TabsContent value="preview">
            <Markdown className="card-text px-2">{value}</Markdown>
          </TabsContent>
        </Box>
      </Tabs>
      {aiAgreementModal && (
        <OptInModal
          agreement="ai"
          onClose={() => {
            if (onOptInModalClose) {
              onOptInModalClose();
            }
            setAiAgreementModal(false);
          }}
        />
      )}
    </Box>
  );
};
export default MarkdownInput;
