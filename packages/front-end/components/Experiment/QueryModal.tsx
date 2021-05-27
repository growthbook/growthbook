import { FC } from "react";
import { QueryLanguage } from "back-end/types/datasource";
import Modal from "../Modal";
import Code from "../Code";

const QueryModal: FC<{
  queries: string[];
  language: QueryLanguage;
  close: () => void;
}> = ({ queries, language, close }) => {
  return (
    <Modal
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
