import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { BsStars } from "react-icons/bs";
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
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
  aiSuggestFunction?: () => Promise<string>;
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
  aiSuggestFunction,
}: Props) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
            setEdit(false);
          } catch (e) {
            setError(e.message);
          }
          setLoading(false);
        }}
      >
        {header && <div className={headerClassName}>{header}</div>}
        {loading && <LoadingOverlay />}
        <MarkdownInput
          value={val}
          setValue={setVal}
          cta={"Save"}
          error={error ?? undefined}
          autofocus={true}
          onCancel={() => setEdit(false)}
          aiSuggestFunction={aiSuggestFunction}
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
            <Flex className="card-text" gap="5">
              {canCreate ? (
                <>
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
                  {aiSuggestFunction && (
                    <a
                      href="#"
                      className="link-purple"
                      onClick={async (e) => {
                        e.preventDefault();
                        setLoading(true);
                        try {
                          const suggestion = await aiSuggestFunction();
                          if (suggestion) {
                            setVal(suggestion);
                          }
                          setLoading(false);
                          setEdit(true);
                        } catch (e) {
                          setLoading(false);
                          setError(e.message);
                        }
                      }}
                    >
                      Suggest Description <BsStars />
                    </a>
                  )}
                </>
              ) : (
                <em>No {label}</em>
              )}
            </Flex>
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
    </Box>
  );
}
