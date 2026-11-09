#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createNear } from "./near.js";
import { createServer } from "./server.js";

const cfg = loadConfig(process.env);
const server = createServer(createNear(cfg.rpcUrl, cfg.accountId, cfg.privateKey), cfg);
await server.connect(new StdioServerTransport());
