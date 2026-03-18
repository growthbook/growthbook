/**
 * Fields that are managed by BaseModel and must never be set directly
 * in create or update operations.
 */
type ProtectedBaseFields =
  | "id"
  | "uid"
  | "organization"
  | "dateCreated"
  | "dateUpdated";

/**
 * Marks each key in Keys as `?: never` so that spreading a full document
 * into a create/update call produces a type error instead of silently
 * passing the protected fields through.
 */
type Forbid<Keys extends string> = { [K in Keys]?: never };

export type CreateProps<T extends object> = Omit<T, ProtectedBaseFields> & {
  id?: string;
};

export type UpdateProps<T extends object> = Partial<
  Omit<T, ProtectedBaseFields>
> &
  Forbid<ProtectedBaseFields>;
