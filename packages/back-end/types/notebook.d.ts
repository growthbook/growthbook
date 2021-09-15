export type KernelSpec = {
  display_name: "Python 3";
  language: "python";
  name: "python3";
};

export type LanguageInfo = {
  codemirror_mode: {
    name: "ipython";
    version: 3;
  };
  file_extension: ".py";
  mimetype: "text/x-python";
  name: "python";
  nbconvert_exporter: "python";
  pygments_lexer: "ipython3";
  version: string;
};
export type CellMetadata = {
  collapsed?: boolean;
};

export type MultilineString = string | string[];

export type CodeOutputStream = {
  name: "stdout" | "stderr";
  output_type: "stream";
  text: MultilineString;
};
export type CodeOutputDisplayData = {
  output_type: "display_data";
  data: {
    // eslint-disable-next-line
    [mimetype: string]: any;
  };
  metadata?: {
    // eslint-disable-next-line
    [mimetype: string]: any;
  };
};
export type CodeOutputError = {
  ename: string;
  evalue: string;
  traceback?: string[];
};

export type CodeOutput =
  | CodeOutputStream
  | CodeOutputDisplayData
  | CodeOutputError;

export type CodeCell = {
  cell_type: "code";
  execution_count: number;
  metadata: CellMetadata;
  outputs: CodeOutput[];
  source: MultilineString;
};

export type MarkdownCell = {
  cell_type: "markdown";
  metadata: CellMetadata;
  source: MultilineString;
  attachments?: {
    [filename: string]: {
      [mimetype: string]: MultilineString;
    };
  };
};

export type Cell = CodeCell | MarkdownCell;

export type Notebook = {
  nbformat: 4;
  nbformat_minor: 1;
  metadata: {
    kernelspec: KernelSpec;
    language_info: LanguageInfo;
  };
  cells: Cell[];
};
