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
import { Box, Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { uploadFile } from "@/services/files";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
import { useAISettings } from "@/hooks/useOrgSettings";
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
  onCancel?: () => void;
}> = ({
  value,
  setValue,
  autofocus = false,
  error,
  cta,
  id,
  onCancel,
  placeholder,
  aiSuggestFunction,
}) => {
  const { aiEnabled } = useAISettings();
  const [activeControlledTab, setActiveControlledTab] = useState<
    "write" | "preview"
  >("write");
  const { apiCall } = useAuth();
  const textareaRef = useRef<null | HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const [aiSuggestionText, setAiSuggestionText] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState("");
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

          {aiSuggestFunction && (
            <Flex justify="end">
              <Button
                variant="ghost"
                title={
                  !aiEnabled
                    ? "AI is disabled for your organization. Adjust in settings."
                    : ""
                }
                disabled={!aiEnabled || !aiSuggestFunction || loading}
                onClick={async () => {
                  if (aiEnabled) {
                    setAiError("");
                    try {
                      setLoading(true);
                      // make sure it's on the right tab:
                      setActiveControlledTab("write");
                      const suggestedText = await aiSuggestFunction();
                      if (suggestedText) {
                        setAiSuggestionText(suggestedText);
                        setLoading(false);
                      } else {
                        setLoading(false);
                        setAiError("Failed to get AI suggestion");
                      }
                    } catch (e) {
                      setLoading(false);
                      setAiError(
                        "Failed to get AI suggestion. API request error"
                      );
                    }
                  }
                }}
              >
                {loading ? "Generating..." : "Get AI Suggestion "}
                <BsStars />
              </Button>
            </Flex>
          )}
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
            {aiSuggestionText && (
              <div className="mt-2">
                <hr />
                <h4>AI Suggestion</h4>
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
            {aiError && (
              <div className="alert alert-danger mt-2">{aiError}</div>
            )}
          </TabsContent>
          <TabsContent value="preview">
            <Markdown className="card-text px-2">{value}</Markdown>
          </TabsContent>
        </Box>
      </Tabs>
    </Box>
  );
};
export default MarkdownInput;
