import { FC } from "react";
import { QueryLanguage } from "shared/types/datasource";
import Code from "@/components/SyntaxHighlighting/Code";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

const QueryModal: FC<{
  queries: string[];
  language: QueryLanguage;
  close: () => void;
}> = ({ queries, language, close }) => {
  return (
    <ModalStandard
      trackingEventModalType=""
      close={close}
      header="View Query"
      open={true}
      size="max"
    >
      {queries.map((query, i) => (
        <Code language={language} key={i} code={query} />
      ))}
    </ModalStandard>
  );
};

export default QueryModal;
