/**
 * Fields that are always managed by BaseModel and must never be set
 * directly in create or update operations.
 *
 * Note: `id` is intentionally NOT included here — it is forbidden via the
 * model's primary-key type parameter (PK) so that models with a non-`id`
 * primary key (e.g. WatchModel) don't needlessly forbid `id`.
 */
type ProtectedBaseFields =
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

export type CreateProps<T extends object> = Omit<
  T,
  ProtectedBaseFields | "id"
> & {
  id?: string;
};

export type UpdateProps<
  T extends object,
  ExtraForbidden extends string = "id",
> = Partial<Omit<T, ProtectedBaseFields | ExtraForbidden>> &
  Forbid<ProtectedBaseFields | ExtraForbidden>;
