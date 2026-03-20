#!/usr/bin/env bun
/**
 * CliBridge Setup Script
 *
 * Interactive setup for the VisualWorks CliBridge MCP server.
 * Run with: bun setup.ts
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import net from "net";
import os from "os";
import path from "path";
import { confirm, input, select } from "@inquirer/prompts";

// ─── Helpers ────────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function banner() {
  console.log();
  console.log(`${BOLD}CliBridge Setup${RESET}`);
  console.log(
    `${DIM}Configure the VisualWorks Smalltalk MCP server for Claude Code${RESET}`
  );
  console.log();
}

function step(n: number, label: string) {
  console.log(`${CYAN}[${n}/7]${RESET} ${BOLD}${label}${RESET}`);
}

function ok(msg: string) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}
function warn(msg: string) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`);
}
function fail(msg: string) {
  console.log(`  ${RED}✗${RESET} ${msg}`);
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

// ─── Config types ───────────────────────────────────────────────────────────

interface ServerEntry {
  host: string;
  port: number;
}

interface ServersConfig {
  servers: Record<string, ServerEntry>;
  default: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "clibridge");
const CONFIG_PATH = path.join(CONFIG_DIR, "servers.json");

// ─── Steps ──────────────────────────────────────────────────────────────────

async function checkPrerequisites(): Promise<{ hasNode: boolean; hasClaude: boolean }> {
  step(1, "Checking prerequisites");

  const nodeVersion = tryExec("node --version");
  if (nodeVersion) {
    ok(`node ${nodeVersion}`);
  } else {
    warn("node not found — needed to run the MCP server");
  }

  const claudeVersion = tryExec("claude --version");
  if (claudeVersion) {
    ok(`claude ${claudeVersion}`);
  } else {
    warn("claude CLI not found — MCP registration will be skipped");
  }

  console.log();
  return { hasNode: !!nodeVersion, hasClaude: !!claudeVersion };
}

function installDependencies() {
  step(2, "Installing dependencies");

  try {
    execSync("bun install", { stdio: "inherit" });
    ok("Dependencies installed");
  } catch {
    fail("bun install failed");
    process.exit(1);
  }

  console.log();
}

async function configureServers(): Promise<ServersConfig> {
  step(3, "Configuring CliBridge servers");

  // Check for existing config
  if (existsSync(CONFIG_PATH)) {
    try {
      const existing: ServersConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      const entries = Object.entries(existing.servers);

      console.log(`  Found existing config at ${DIM}${CONFIG_PATH}${RESET}`);
      for (const [name, s] of entries) {
        const def = name === existing.default ? ` ${DIM}(default)${RESET}` : "";
        console.log(`    ${name}: ${s.host}:${s.port}${def}`);
      }

      const keep = await confirm({ message: "Keep existing config?" });
      if (keep) {
        console.log();
        return existing;
      }
    } catch {
      warn("Existing config is invalid, starting fresh");
    }
  }

  // Interactive server configuration
  const servers: Record<string, ServerEntry> = {};
  const suggestions = ["local", "dev", "staging", "production"];
  let index = 0;

  while (true) {
    const name = await input({
      message: "Server name",
      default: suggestions[index] ?? `server-${index + 1}`,
    });

    const portStr = await input({
      message: "Port",
      default: "9999",
      validate: (val) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1024 || n > 65535) {
          return "Port must be a number between 1024 and 65535";
        }
        return true;
      },
    });

    servers[name] = { host: "localhost", port: parseInt(portStr, 10) };
    index++;

    const another = await confirm({ message: "Add another server?", default: false });
    if (!another) break;
  }

  // Determine default
  const names = Object.keys(servers);
  let defaultServer: string;

  if (names.length === 1) {
    defaultServer = names[0];
  } else {
    defaultServer = await select({
      message: "Which server should be the default?",
      choices: names.map((n) => ({ name: n, value: n })),
    });
  }

  const config: ServersConfig = { servers, default: defaultServer };

  // Write config
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  ok(`Config written to ${CONFIG_PATH}`);

  console.log();
  return config;
}

async function registerWithClaude(hasClaude: boolean) {
  step(4, "Registering MCP server with Claude Code");

  if (!hasClaude) {
    warn("claude CLI not found — skipping registration");
    console.log(`  Install Claude Code and run this again, or register manually:`);
    console.log(`  ${DIM}claude mcp add -s user -t stdio -e CLIBRIDGE_CONFIG=${CONFIG_PATH} visualworks -- node ${path.resolve("vw_mcp_server.js")}${RESET}`);
    console.log();
    return;
  }

  // Check if already registered
  const existing = tryExec("claude mcp get visualworks 2>&1");
  const isRegistered = existing !== null && !existing.includes("No MCP server") && !existing.includes("not found");

  if (isRegistered) {
    console.log(`  Currently registered:`);
    console.log(`  ${DIM}${existing}${RESET}`);

    const update = await confirm({ message: "Update registration?" });
    if (!update) {
      console.log();
      return;
    }

    // Remove existing before re-adding
    tryExec("claude mcp remove -s user visualworks 2>&1");
  }

  const serverPath = path.resolve("vw_mcp_server.js");
  const cmd = `claude mcp add -s user -t stdio -e CLIBRIDGE_CONFIG=${CONFIG_PATH} visualworks -- node ${serverPath}`;

  const result = tryExec(cmd);
  if (result !== null) {
    ok("Registered as 'visualworks' (user scope)");
  } else {
    fail("Registration failed");
    console.log(`  Try manually: ${DIM}${cmd}${RESET}`);
  }

  console.log();
}

async function testConnectivity(config: ServersConfig) {
  step(5, "Testing connectivity");

  const results: Record<string, boolean> = {};

  for (const [name, server] of Object.entries(config.servers)) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      let response = "";

      socket.setTimeout(2000);

      socket.on("connect", () => {
        socket.write("PING\n");
      });

      socket.on("data", (data) => {
        response += data.toString();
        try {
          const parsed = JSON.parse(response.trim().split("\n")[0]);
          if (parsed.status === "ok") {
            resolve(true);
          } else {
            resolve(false);
          }
        } catch {
          // Wait for more data
        }
      });

      socket.on("end", () => {
        try {
          const parsed = JSON.parse(response.trim().split("\n")[0]);
          resolve(parsed.status === "ok");
        } catch {
          resolve(false);
        }
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("error", () => {
        resolve(false);
      });

      socket.connect(server.port, server.host);
    });

    results[name] = connected;
    if (connected) {
      ok(`${name} (localhost:${server.port}) — connected`);
    } else {
      warn(`${name} (localhost:${server.port}) — not reachable`);
    }
  }

  console.log();
  return results;
}

function printNextSteps(
  config: ServersConfig,
  connectivity: Record<string, boolean>
) {
  step(6, "Next steps");
  console.log();

  const cliBridgePath = path.resolve("CliBridge.st");
  const unreachable = Object.entries(connectivity).filter(([, ok]) => !ok);

  if (unreachable.length > 0) {
    console.log(`  To start CliBridge in VisualWorks:`);
    console.log();
    console.log(`    ${DIM}(Filename named: '${cliBridgePath}') fileIn.${RESET}`);

    for (const [name] of unreachable) {
      const port = config.servers[name].port;
      console.log(`    ${DIM}CliBridge startOn: ${port}.${RESET}`);
    }

    console.log();
  }

  console.log(`  Then restart Claude Code to pick up the new MCP server.`);
  console.log();
  console.log(`${GREEN}${BOLD}Setup complete!${RESET}`);
  console.log();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  banner();

  const { hasClaude } = await checkPrerequisites();
  installDependencies();
  const config = await configureServers();
  await registerWithClaude(hasClaude);
  const connectivity = await testConnectivity(config);
  printNextSteps(config, connectivity);
}

main().catch((err) => {
  console.error(`\n${RED}Setup failed:${RESET} ${err.message}`);
  process.exit(1);
});
