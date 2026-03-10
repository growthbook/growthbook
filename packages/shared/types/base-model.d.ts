export type CreateProps<T extends object> = Omit<
  T,
  "id" | "uid" | "organization" | "dateCreated" | "dateUpdated"
> & { id?: string };

export type UpdateProps<T extends object> = Partial<
  Omit<T, "id" | "uid" | "organization" | "dateCreated" | "dateUpdated">
>;
