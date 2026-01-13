// Polyfill web streams for Node.js test environment
import { TransformStream } from "node:stream/web";
global.TransformStream = TransformStream as typeof globalThis.TransformStream;
