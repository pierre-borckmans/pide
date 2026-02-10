/**
 * IDE Integration Extension for pi
 *
 * Integrates pi with external IDEs (VS Code, JetBrains, etc.) to show
 * currently selected file/code in the bottom right corner.
 *
 * Features:
 * - File-based communication (all pi instances see the selection)
 * - Shows selection status in bottom-right widget
 * - Commands to insert selection into conversation
 * - Keyboard shortcut to insert selection
 *
 * How it works:
 * 1. IDE writes selection to ~/.pi/ide-selection.json
 * 2. ALL running pi instances watch this file
 * 3. Each pi shows the widget - user interacts with whichever terminal they're in
 *
 * File format (~/.pi/ide-selection.json):
 * {
 *   "file": "/path/to/file.ts",
 *   "selection": "selected code text",
 *   "startLine": 10,
 *   "endLine": 15,
 *   "ide": "vscode",
 *   "timestamp": 1707570000000
 * }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// File-based communication (primary)
const PI_DIR = path.join(os.homedir(), ".pi");
const SELECTION_FILE = path.join(PI_DIR, "ide-selection.json");

// Optional HTTP server (secondary, for direct IDE communication)
const DEFAULT_PORT = 9876;

interface IDESelection {
  file: string;
  selection?: string;
  startLine?: number;
  endLine?: number;
  ide?: string;
  timestamp: number;
}

let currentSelection: IDESelection | null = null;
let lastCtx: ExtensionContext | null = null;
let fileWatcher: fs.FSWatcher | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let httpServer: http.Server | null = null;
let lastFileContent: string | null = null;

function getLineCount(selection: IDESelection): number {
  if (selection.startLine !== undefined && selection.endLine !== undefined) {
    return selection.endLine - selection.startLine + 1;
  }
  if (selection.selection) {
    return selection.selection.split("\n").length;
  }
  return 0;
}

function getShortPath(filePath: string, maxLen = 40): string {
  const basename = path.basename(filePath);
  const dirname = path.dirname(filePath);

  if (filePath.length <= maxLen) {
    return filePath;
  }

  // Try to show .../parent/file.ext
  const parent = path.basename(dirname);
  const short = `.../${parent}/${basename}`;

  if (short.length <= maxLen) {
    return short;
  }

  return `.../${basename}`;
}

function updateStatus(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;

  const theme = ctx.ui.theme;

  if (!currentSelection) {
    ctx.ui.setStatus("ide-selection", undefined);
    return;
  }

  const lineCount = getLineCount(currentSelection);
  const shortPath = getShortPath(currentSelection.file, 30);
  const fileName = path.basename(currentSelection.file);
  const ide = currentSelection.ide || "IDE";
  const hint = theme.fg("dim", " (ctrl+i to insert) │");

  let statusText = "";

  if (currentSelection.selection) {
    // We have selected text
    const icon = theme.fg("accent", "󰆏");
    const lines = theme.fg("success", `${lineCount}`);
    const file = theme.fg("muted", fileName);
    const ideName = theme.fg("accent", ide);
    statusText = `${icon} ${lines}${theme.fg("dim", " lines selected from ")}${file}${theme.fg("dim", " in ")}${ideName}${hint}`;
  } else {
    // Just an open file, no selection
    const icon = theme.fg("accent", "󰈔");
    const filePath = theme.fg("muted", shortPath);
    const ideName = theme.fg("accent", ide);
    statusText = `${icon} ${filePath}${theme.fg("dim", " in ")}${ideName}${hint}`;
  }

  ctx.ui.setStatus("ide-selection", statusText);
}

function readSelectionFile(): IDESelection | null {
  try {
    if (fs.existsSync(SELECTION_FILE)) {
      const content = fs.readFileSync(SELECTION_FILE, "utf-8");
      const data = JSON.parse(content);

      // Ignore stale selections (older than 1 hour)
      if (data.timestamp && Date.now() - data.timestamp > 3600000) {
        return null;
      }

      return data;
    }
  } catch {
    // File doesn't exist or invalid JSON
  }
  return null;
}

function writeSelectionFile(selection: IDESelection | null) {
  try {
    // Ensure .pi directory exists
    if (!fs.existsSync(PI_DIR)) {
      fs.mkdirSync(PI_DIR, { recursive: true });
    }

    if (selection) {
      fs.writeFileSync(SELECTION_FILE, JSON.stringify(selection, null, 2));
    } else {
      // Clear by writing empty object or deleting
      if (fs.existsSync(SELECTION_FILE)) {
        fs.unlinkSync(SELECTION_FILE);
      }
    }
  } catch (e) {
    console.error("Failed to write selection file:", e);
  }
}

function checkForFileChanges() {
  try {
    let newContent: string | null = null;
    if (fs.existsSync(SELECTION_FILE)) {
      newContent = fs.readFileSync(SELECTION_FILE, "utf-8");
    }

    // Only update if content changed
    if (newContent !== lastFileContent) {
      lastFileContent = newContent;
      currentSelection = readSelectionFile();
      if (lastCtx) {
        updateStatus(lastCtx);
      }
    }
  } catch {
    // Ignore read errors
  }
}

function startFileWatcher() {
  // Ensure directory exists
  if (!fs.existsSync(PI_DIR)) {
    fs.mkdirSync(PI_DIR, { recursive: true });
  }

  // Try fs.watch first (instant on some systems)
  try {
    fileWatcher = fs.watch(SELECTION_FILE, () => {
      checkForFileChanges();
    });
    fileWatcher.on("error", () => {
      // File might not exist yet, that's ok
    });
  } catch {
    // File doesn't exist yet, will rely on polling
  }

  // Also poll every 500ms as fallback (fs.watch can be unreliable on macOS)
  pollInterval = setInterval(checkForFileChanges, 500);
}

function createHttpServer(port: number): http.Server {
  return http.createServer((req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === "/selection") {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            const selection: IDESelection = {
              file: data.file || "",
              selection: data.selection,
              startLine: data.startLine,
              endLine: data.endLine,
              ide: data.ide,
              timestamp: Date.now(),
            };

            // Write to file (all pi instances will see it)
            writeSelectionFile(selection);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
      } else if (req.method === "DELETE") {
        writeSelectionFile(null);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } else if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(currentSelection || { selection: null }));
      } else {
        res.writeHead(405);
        res.end();
      }
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", port }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}

function formatSelectionForContext(selection: IDESelection): string {
  // URL-style format: /path/to/file.ts:10-15
  let fileRef = selection.file;
  if (selection.startLine !== undefined && selection.endLine !== undefined) {
    if (selection.startLine === selection.endLine) {
      fileRef += `:${selection.startLine}`;
    } else {
      fileRef += `:${selection.startLine}-${selection.endLine}`;
    }
  }
  return `Referencing ${fileRef}`;
}

export default function ideIntegration(pi: ExtensionAPI) {
  // Register flag for HTTP server (optional, disabled by default)
  pi.registerFlag("ide-server", {
    description: "Enable HTTP server for IDE integration (optional)",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("ide-port", {
    description: "Port for IDE HTTP server (requires --ide-server)",
    type: "number",
    default: DEFAULT_PORT,
  });

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;

    // Start file watcher (primary method - works for all instances)
    startFileWatcher();

    // Read initial selection (after watcher is set up)
    checkForFileChanges();

    // Optionally start HTTP server (secondary method)
    const enableServer = pi.getFlag("--ide-server") as boolean;
    if (enableServer && !httpServer) {
      const port = (pi.getFlag("--ide-port") as number) || DEFAULT_PORT;
      httpServer = createHttpServer(port);

      httpServer.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          if (ctx.hasUI) {
            ctx.ui.notify(`IDE HTTP server port ${port} in use (file-based still works)`, "warning");
          }
        }
      });

      httpServer.listen(port, "127.0.0.1", () => {
        if (ctx.hasUI) {
          ctx.ui.notify(`IDE HTTP server on port ${port}`, "info");
        }
      });
    }

    // Show widget if we have a selection
    updateStatus(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    lastCtx = ctx;
    checkForFileChanges();
  });

  pi.on("session_shutdown", async () => {
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
  });

  // Command to insert IDE selection into editor
  pi.registerCommand("ide", {
    description: "Insert current IDE selection into the conversation",
    handler: async (_args, ctx) => {
      // Re-read in case it changed
      currentSelection = readSelectionFile();

      if (!currentSelection) {
        ctx.ui.notify("No IDE selection available", "warning");
        return;
      }

      const text = formatSelectionForContext(currentSelection) + "\n";
      ctx.ui.setEditorText(text);
    },
  });

  // Command to clear IDE selection
  pi.registerCommand("ide-clear", {
    description: "Clear the current IDE selection",
    handler: async (_args, ctx) => {
      writeSelectionFile(null);
      ctx.ui.notify("IDE selection cleared", "info");
    },
  });

  // Shortcut to quickly insert selection
  pi.registerShortcut("ctrl+i", {
    description: "Insert IDE selection into editor",
    handler: async (ctx) => {
      currentSelection = readSelectionFile();

      if (!currentSelection) {
        ctx.ui.notify("No IDE selection", "warning");
        return;
      }

      const text = formatSelectionForContext(currentSelection) + "\n";
      ctx.ui.pasteToEditor(text);
    },
  });


}
