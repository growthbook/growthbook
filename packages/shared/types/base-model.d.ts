export type CreateProps<T extends object> = Omit<
  T,
  "id" | "organization" | "dateCreated" | "dateUpdated"
> & { id?: string };

export type UpdateProps<T extends object> = Partial<
  Omit<T, "id" | "organization" | "dateCreated" | "dateUpdated">
>;
