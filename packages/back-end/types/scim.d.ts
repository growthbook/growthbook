import { Request } from "express";
import { ApiRequestLocals } from "./api";

export type BaseScimRequest = Request & ApiRequestLocals;

export interface ScimEmail {
  primary: boolean;
  value: string;
  type: string;
  display: string;
}

export interface ScimUser {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
  id: string;
  displayName: string;
  userName: string;
  active: boolean;
  externalId?: string;
  growthbookRole?: string;
}

export interface ScimGroupMember {
  value: string; // User ID
  display: string; // Username
}

export interface ScimGroup {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"];
  id: string;
  displayName: string;
  members: ScimGroupMember[];
  meta: {
    resourceType: "Group";
  };
  growthbookRole?: string;
}

export interface ScimListResponse {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"];
  totalResults: number;
  Resources: ScimUser[] | ScimGroup[];
  startIndex: number;
  itemsPerPage: number;
}

export interface ScimError {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"];
  scimType?: string;
  status: string;
  detail: string;
}

export type ScimGetRequest = BaseScimRequest & {
  params: {
    id: string;
  };
};

export interface ScimUserPostRequest extends BaseScimRequest {
  body: ScimUser;
}

export interface ScimUserPutRequest extends ScimUserPostRequest {
  params: {
    id: string;
  };
}

export interface ScimGroupPostRequest extends BaseScimRequest {
  body: ScimGroup;
}

export interface ScimListRequest extends BaseScimRequest {
  query: {
    filter?: string;
    startIndex?: string;
    count?: string;
  };
}

type ScimOperation = {
  op: "add" | "remove" | "replace";
  path?: string; // Path is optional for add & replace, and required for remove operations
  // Okta sends over value as an object and azure sends value as a string
  value: string | { [key: string]: boolean };
};

export interface BasicScimGroup {
  id: string;
  displayName: string;
  growthbookRole?: string;
}

type ScimGroupOperation = {
  op: "add" | "remove" | "replace";
  path?: string; // Path is optional for add & replace, and required for remove operations
  value: ScimGroupMember[] | BasicScimGroup;
};

export interface ScimPatchRequest extends BaseScimRequest {
  params: {
    id: string;
  };
  body: {
    Operations: ScimOperation[];
  };
}

export interface ScimGroupPatchRequest extends BaseScimRequest {
  params: {
    id: string;
  };
  body: {
    Operations: ScimGroupOperation[];
  };
}

export interface ScimServiceProviderConfig {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"];
  documentationUri?: string;
  patch: {
    supported: boolean;
  };
  bulk: {
    supported: boolean;
    maxOperations: number;
    maxPayloadSize: number;
  };
  filter: {
    supported: boolean;
    maxResults: number;
  };
  changePassword: {
    supported: boolean;
  };
  sort: {
    supported: boolean;
  };
  etag: {
    supported: boolean;
  };
  authenticationSchemes: Array<{
    type: string;
    name: string;
    description: string;
    specUri?: string;
    primary?: boolean;
  }>;
  meta?: {
    resourceType: string;
    location: string;
  };
}

export interface ScimSchemaAttribute {
  name: string;
  type:
    | "string"
    | "boolean"
    | "decimal"
    | "integer"
    | "dateTime"
    | "reference"
    | "complex";
  multiValued: boolean;
  description: string;
  required: boolean;
  caseExact?: boolean;
  mutability: "readOnly" | "readWrite" | "immutable" | "writeOnly";
  returned: "always" | "never" | "default" | "request";
  uniqueness?: "none" | "server" | "global";
  subAttributes?: ScimSchemaAttribute[];
}

export interface ScimSchema {
  id: string;
  name: string;
  description: string;
  attributes: ScimSchemaAttribute[];
  meta: {
    resourceType: "Schema";
    location: string;
  };
}

export interface ScimSchemasResponse {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"];
  totalResults: number;
  itemsPerPage: number;
  startIndex: number;
  Resources: ScimSchema[];
}
