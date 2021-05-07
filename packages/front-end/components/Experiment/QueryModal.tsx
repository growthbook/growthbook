import { FC } from "react";
import { QueryLanguage } from "back-end/types/datasource";
import Modal from "../Modal";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { okaidia as style } from "react-syntax-highlighter/dist/cjs/styles/prism";

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
        <SyntaxHighlighter language={language} style={style} key={i}>
          {query}
        </SyntaxHighlighter>
      ))}
    </Modal>
  );
};

export default QueryModal;
