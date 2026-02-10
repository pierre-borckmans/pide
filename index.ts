/**
 * pide - IDE Integration Extension for pi
 *
 * Integrates pi with external IDEs (VS Code, JetBrains, etc.) to show
 * currently selected file/code in the footer.
 *
 * Features:
 * - File-based communication (all pi instances see the selection)
 * - Shows selection status in footer
 * - Ctrl+I to insert file reference into conversation
 * - /ide-setup to install IDE plugins
 *
 * How it works:
 * 1. IDE plugin writes selection to ~/.pi/ide-selection.json
 * 2. All running pi instances watch this file
 * 3. Press Ctrl+I to reference the selection in your prompt
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// File-based communication
const PI_DIR = path.join(os.homedir(), ".pi");
const SELECTION_FILE = path.join(PI_DIR, "ide-selection.json");

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
  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;

    // Start file watcher
    startFileWatcher();

    // Read initial selection (after watcher is set up)
    checkForFileChanges();

    // Show status if we have a selection
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

  // Setup command to install IDE plugins
  pi.registerCommand("ide-setup", {
    description: "Install IDE plugin for pide",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Select your IDE:", [
        "VS Code / Cursor / VSCodium",
        "JetBrains (IntelliJ, GoLand, WebStorm, PyCharm, etc.)",
        "Cancel",
      ]);

      if (!choice || choice === "Cancel") return;

      const GITHUB_REPO = "pierre-borckmans/pide";
      const RELEASE_TAG = "v0.1.1";

      if (choice.startsWith("VS Code")) {
        await installVSCodePlugin(ctx, pi, GITHUB_REPO, RELEASE_TAG);
      } else if (choice.startsWith("JetBrains")) {
        await installJetBrainsPlugin(ctx, pi, GITHUB_REPO, RELEASE_TAG);
      }
    },
  });
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const https = await import("node:https");
  
  return new Promise((resolve, reject) => {
    const followRedirect = (url: string) => {
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          followRedirect(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download: ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      }).on("error", reject);
    };
    followRedirect(url);
  });
}

async function installVSCodePlugin(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  repo: string,
  tag: string
) {
  const vsixUrl = `https://github.com/${repo}/releases/download/${tag}/pide-vscode.vsix`;
  const tmpDir = path.join(os.tmpdir(), "pide-install");
  const vsixPath = path.join(tmpDir, "pide-vscode.vsix");

  ctx.ui.notify("Downloading VS Code extension...", "info");

  try {
    // Create temp directory
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Download the vsix
    await downloadFile(vsixUrl, vsixPath);

    // Detect which VS Code variant to use
    const codeCommands = ["code", "cursor", "codium"];
    let installedWith: string | null = null;

    for (const cmd of codeCommands) {
      try {
        const result = await pi.exec("which", [cmd], { timeout: 5000 });
        if (result.code === 0) {
          ctx.ui.notify(`Installing with ${cmd}...`, "info");
          const installResult = await pi.exec(cmd, ["--install-extension", vsixPath], { timeout: 30000 });
          if (installResult.code === 0) {
            installedWith = cmd;
            break;
          }
        }
      } catch {
        // Command not found, try next
      }
    }

    // Cleanup
    fs.unlinkSync(vsixPath);

    if (installedWith) {
      ctx.ui.notify(`✓ VS Code extension installed with ${installedWith}! Restart your editor.`, "info");
    } else {
      ctx.ui.notify("Could not find VS Code, Cursor, or VSCodium. Install manually from GitHub releases.", "warning");
    }
  } catch (e) {
    ctx.ui.notify(`Failed to install: ${e}`, "error");
  }
}

async function installJetBrainsPlugin(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  repo: string,
  tag: string
) {
  const zipUrl = `https://github.com/${repo}/releases/download/${tag}/pide-jetbrains.zip`;
  const tmpDir = path.join(os.tmpdir(), "pide-install");
  const zipPath = path.join(tmpDir, "pide-jetbrains.zip");

  ctx.ui.notify("Downloading JetBrains plugin...", "info");

  try {
    // Create temp directory
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Download the zip
    await downloadFile(zipUrl, zipPath);

    ctx.ui.notify(`✓ Downloaded to ${zipPath}`, "info");
    ctx.ui.notify("To install: Settings → Plugins → ⚙️ → Install from Disk → select the zip file", "info");
    
    // Try to open the folder
    await pi.exec("open", [tmpDir], { timeout: 5000 });
  } catch (e) {
    ctx.ui.notify(`Failed to download: ${e}. Visit https://github.com/${repo}/releases`, "error");
  }
}
