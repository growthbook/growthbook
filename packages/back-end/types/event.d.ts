export interface EventInterface<T> {
  id: string;
  dateCreated: Date;
  error: string | null;
  data: T;
  organizationId: string;
}
