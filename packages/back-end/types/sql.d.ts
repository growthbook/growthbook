export type TemplateVariables = {
  [key: string]: string | undefined;
};

export type SQLVars = {
  startDate: Date;
  endDate?: Date;
  experimentId?: string;
  templateVariables?: TemplateVariables;
};
