import { Request } from "express";
import { OrganizationInterface } from "./organization";

// export interface ScimRequest {
//   schemas: string[];
//   externalId: string;
//   displayName: string;
//   meta: {
//     resourceType: string;
//   };
// }

export type BaseScimRequest = Request & {
  organization: OrganizationInterface;
};

export type ScimGetRequest = BaseScimRequest & {
  params: {
    id: string;
  };
};

export type ScimPostRequest = BaseScimRequest & {
  // TODO: The body might actually be encrypted
  body: {
    schemas: string[];
    externalId: string;
    displayName: string;
    meta: {
      resourceType: string;
    };
  };
};

export type ScimListRequest = BaseScimRequest & {
  query: {
    filter: string;
  };
};

export type ScimUpdateRequest = BaseScimRequest & {
  params: {
    id: string;
  };
  body: {
    Operations: {
      op: string; //TODO: Can I make this an enum?
      path: string; //TODO: Can I make this an enum?
      value: unknown;
    }[];
  };
};
