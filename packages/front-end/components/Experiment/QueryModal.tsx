import { FC } from "react";
import { QueryLanguage } from "shared/types/datasource";
import Modal from "@/components/Modal";
import Code from "@/components/SyntaxHighlighting/Code";

const QueryModal: FC<{
  queries: string[];
  language: QueryLanguage;
  close: () => void;
}> = ({ queries, language, close }) => {
  return (
    <Modal
      trackingEventModalType=""
      close={close}
      header="View Query"
      open={true}
      size="max"
      closeCta="Close"
    >
      {queries.map((query, i) => (
        <Code language={language} key={i} code={query} />
      ))}
    </Modal>
  );
};

export default QueryModal;
