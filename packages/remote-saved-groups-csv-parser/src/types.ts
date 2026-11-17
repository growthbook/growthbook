export type RemoteGroupCsvOptions = {
  /** The group's attribute; a first line equal to it is a header. */
  attributeKey: string;
  /** Whether the attribute is a number, so every ID must be one. */
  numeric: boolean;
  /** Called with each valid ID, as stored and looked up. */
  onId?: (id: string) => void;
};

export type RemoteGroupCsvResult =
  | {
      type: "valid";
      /** IDs in the file, before removing duplicates. */
      idCount: number;
    }
  | {
      type: "invalid";
      invalidLineCount: number;
      /** The first problems, at most `MAX_ERRORS`. */
      errors: string[];
    };
