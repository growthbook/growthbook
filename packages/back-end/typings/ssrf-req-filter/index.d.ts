import { Agent } from "http";

declare module "ssrf-req-filter" {
  export default function ssrfReqFilter(url: string): Agent;
}
