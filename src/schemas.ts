import type { AddressInfo } from "node:net";
import { type } from "arktype";

const listeningAddress = type({
  address: "string",
  family: "string",
  port: "number",
});

const parsePort = (address: AddressInfo | string | null): number =>
  listeningAddress.assert(address).port;

export { parsePort };
