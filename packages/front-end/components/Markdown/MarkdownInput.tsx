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
import { PiArrowClockwise, PiClipboard, PiTrash } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { uploadFile } from "@/services/files";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { SimpleTooltip } from "@/components/SimpleTooltip/SimpleTooltip";
import OptInModal from "@/components/License/OptInModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../Radix/Tabs";
import Markdown from "./Markdown";

const Item = ({ entity: { name, char } }) => <div>{`${name}: ${char}`}</div>;
const Loading = () => <div>Loading</div>;

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
  onCancel?: () => void;
  showButtons?: boolean;
}> = ({
  value,
  setValue,
  autofocus = false,
  error: externalError,
  cta,
  id,
  onCancel,
  placeholder,
  aiSuggestFunction,
  aiButtonText = "Get AI Suggestion",
  aiSuggestionHeader = "Suggestion",
  showButtons = true,
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

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  const [aiAgreementModal, setAiAgreementModal] = useState(false);
  useEffect(() => {
    if (autofocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autofocus, textareaRef.current]);

  const onDrop = (files: File[]) => {
    setUploading(true);
    const toAdd: string[] = [];
    const promises = Promise.all(
      files.map(async (file, i) => {
        const name = file.name.replace(/[^a-zA-Z0-9_\-.\s]*/g, "");

        const { fileURL } = await uploadFile(apiCall, file);

        toAdd[i] = `![${name}](${fileURL})`;
      })
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
      setError("");
      try {
        setLoading(true);
        // make sure it's on the right tab:
        setActiveControlledTab("write");
        const suggestedText = await aiSuggestFunction();
        if (suggestedText) {
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
        <Flex align="center" justify="between">
          <TabsList>
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview" disabled={!value}>
              Preview
            </TabsTrigger>
          </TabsList>
        </Flex>

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
                  Upload images by dragging &amp; dropping or clicking here{" "}
                </div>
              </div>
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
                {aiAgreedTo ? (
                  <Button
                    variant="soft"
                    title={
                      !aiEnabled
                        ? "AI is disabled for your organization. Adjust in settings."
                        : ""
                    }
                    disabled={!aiEnabled || !aiSuggestFunction || loading}
                    onClick={doAISuggestion}
                  >
                    <BsStars /> {loading ? "Generating..." : aiButtonText}
                  </Button>
                ) : (
                  <Button
                    variant="soft"
                    title={
                      !aiEnabled
                        ? "AI is disabled for your organization. Adjust in settings."
                        : ""
                    }
                    disabled={loading}
                    onClick={() => {
                      setAiAgreementModal(true);
                    }}
                  >
                    <BsStars /> {loading ? "Generating..." : aiButtonText}
                  </Button>
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
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setValue("");
                      }}
                    >
                      <PiTrash /> Clear
                    </Button>
                    {copySupported && (
                      <Box style={{ position: "relative" }}>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            performCopy(aiSuggestionText || "");
                          }}
                        >
                          <PiClipboard /> Copy
                        </Button>
                        {copySuccess ? (
                          <SimpleTooltip position="right">
                            Copied to clipboard!
                          </SimpleTooltip>
                        ) : null}
                      </Box>
                    )}
                    <Button variant="ghost" onClick={doAISuggestion}>
                      <PiArrowClockwise /> Try Again
                    </Button>
                  </Flex>
                </Flex>
                <Box className="appbox" p="3">
                  <Markdown className="card-text mb-2">
                    {aiSuggestionText}
                  </Markdown>
                </Box>
                <Button
                  variant="outline"
                  onClick={() => {
                    setValue(aiSuggestionText);
                    setAiSuggestionText("");
                  }}
                >
                  Use this suggestion
                </Button>
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
        <OptInModal agreement="ai" onClose={() => setAiAgreementModal(false)} />
      )}
    </Box>
  );
};
export default MarkdownInput;
