export type TemplateVariables = {
  eventName?: string;
  valueColumn?: string;
};

export type SQLVars = {
  startDate: Date;
  endDate?: Date;
  experimentId?: string;
  templateVariables?: TemplateVariables;
};
