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
  const hint = theme.fg("dim", " (ctrl+; to insert) │");

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
  pi.registerShortcut("ctrl+;", {
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
        "Neovim",
        "Cancel",
      ]);

      if (!choice || choice === "Cancel") return;

      const GITHUB_REPO = "pierre-borckmans/pide";
      const RELEASE_TAG = "v0.1.5";

      if (choice.startsWith("VS Code")) {
        await installVSCodePlugin(ctx, pi, GITHUB_REPO, RELEASE_TAG);
      } else if (choice.startsWith("JetBrains")) {
        await installJetBrainsPlugin(ctx, pi, GITHUB_REPO, RELEASE_TAG);
      } else if (choice === "Neovim") {
        await installNeovimPlugin(ctx, pi, GITHUB_REPO);
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

function getJetBrainsBasePaths(): string[] {
  const home = os.homedir();
  const platform = os.platform();
  
  if (platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "JetBrains")];
  } else if (platform === "linux") {
    return [
      path.join(home, ".local", "share", "JetBrains"),
      path.join(home, ".config", "JetBrains"),
    ];
  } else if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "JetBrains")];
  }
  return [];
}

function getIdeName(dirName: string): string {
  // Map directory names to friendly IDE names
  const match = dirName.match(/^([A-Za-z]+)/);
  if (!match) return dirName;
  
  const base = match[1];
  const mappings: Record<string, string> = {
    "GoLand": "GoLand",
    "IntelliJIdea": "IntelliJ IDEA",
    "WebStorm": "WebStorm",
    "PyCharm": "PyCharm",
    "CLion": "CLion",
    "Rider": "Rider",
    "RubyMine": "RubyMine",
    "PhpStorm": "PhpStorm",
    "DataGrip": "DataGrip",
    "AndroidStudio": "Android Studio",
    "AppCode": "AppCode",
    "RustRover": "RustRover",
  };
  
  return mappings[base] || dirName;
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

    // Find JetBrains plugins directories (cross-platform)
    const basePaths = getJetBrainsBasePaths();
    const ideOptions: { dir: string; name: string; pluginsPath: string }[] = [];

    for (const basePath of basePaths) {
      if (!fs.existsSync(basePath)) continue;
      
      const dirs = fs.readdirSync(basePath).filter(d => {
        const pluginsPath = path.join(basePath, d, "plugins");
        return fs.existsSync(pluginsPath);
      });

      for (const dir of dirs) {
        ideOptions.push({
          dir,
          name: getIdeName(dir),
          pluginsPath: path.join(basePath, dir, "plugins"),
        });
      }
    }

    if (ideOptions.length === 0) {
      ctx.ui.notify(`✓ Downloaded to ${zipPath}`, "info");
      ctx.ui.notify("No JetBrains IDEs found. Install manually: Settings → Plugins → ⚙️ → Install from Disk", "info");
      const openCmd = os.platform() === "darwin" ? "open" : os.platform() === "win32" ? "explorer" : "xdg-open";
      await pi.exec(openCmd, [tmpDir], { timeout: 5000 });
      return;
    }

    // Let user choose which IDE(s) to install to
    const choices = [
      ...ideOptions.map(o => o.name),
      "All IDEs",
      "Cancel",
    ];
    const choice = await ctx.ui.select("Install to which IDE?", choices);

    if (!choice || choice === "Cancel") {
      fs.unlinkSync(zipPath);
      return;
    }

    const targets = choice === "All IDEs"
      ? ideOptions
      : ideOptions.filter(o => o.name === choice);

    // Extract to each selected IDE's plugins folder
    for (const target of targets) {
      // Remove old version if exists
      const oldPlugin = path.join(target.pluginsPath, "pide-jetbrains");
      if (fs.existsSync(oldPlugin)) {
        if (os.platform() === "win32") {
          await pi.exec("rmdir", ["/s", "/q", oldPlugin], { timeout: 5000 });
        } else {
          await pi.exec("rm", ["-rf", oldPlugin], { timeout: 5000 });
        }
      }

      // Extract zip
      if (os.platform() === "win32") {
        await pi.exec("powershell", ["-Command", `Expand-Archive -Force '${zipPath}' '${target.pluginsPath}'`], { timeout: 30000 });
      } else {
        await pi.exec("unzip", ["-o", zipPath, "-d", target.pluginsPath], { timeout: 30000 });
      }
      ctx.ui.notify(`✓ Installed to ${target.name}`, "info");
    }

    // Cleanup
    fs.unlinkSync(zipPath);
    ctx.ui.notify("Restart your IDE to activate the plugin!", "info");
  } catch (e) {
    ctx.ui.notify(`Failed to install: ${e}. Visit https://github.com/${repo}/releases`, "error");
  }
}

function getNeovimConfigPaths(): string[] {
  const home = os.homedir();
  const platform = os.platform();
  
  const paths: string[] = [];
  
  // Standard XDG config path
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  paths.push(path.join(xdgConfig, "nvim"));
  
  // Windows paths
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    paths.push(path.join(localAppData, "nvim"));
  }
  
  return paths;
}

function getNeovimDataPaths(): string[] {
  const home = os.homedir();
  const platform = os.platform();
  
  const paths: string[] = [];
  
  // Standard XDG data path for site packages
  const xdgData = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  paths.push(path.join(xdgData, "nvim", "site", "pack", "pide", "start", "pide"));
  
  // Windows paths
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    paths.push(path.join(localAppData, "nvim-data", "site", "pack", "pide", "start", "pide"));
  }
  
  return paths;
}

async function installNeovimPlugin(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  repo: string
) {
  // Check if Neovim is installed
  try {
    const result = await pi.exec("nvim", ["--version"], { timeout: 5000 });
    if (result.code !== 0) {
      ctx.ui.notify("Neovim not found. Please install Neovim first.", "error");
      return;
    }
  } catch {
    ctx.ui.notify("Neovim not found. Please install Neovim first.", "error");
    return;
  }

  // Check for plugin managers
  const configPaths = getNeovimConfigPaths();
  let configPath: string | null = null;
  
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  // Detect plugin manager
  let hasLazy = false;
  let hasPacker = false;
  let hasVimPlug = false;

  if (configPath) {
    const lazyPath = path.join(configPath, "lua", "plugins");
    const lazyPath2 = path.join(configPath, "lua", "lazy");
    hasLazy = fs.existsSync(lazyPath) || fs.existsSync(lazyPath2) || 
              (fs.existsSync(path.join(configPath, "init.lua")) && 
               fs.readFileSync(path.join(configPath, "init.lua"), "utf-8").includes("lazy"));
    
    const packerPath = path.join(configPath, "lua", "packer");
    hasPacker = fs.existsSync(packerPath) ||
                (fs.existsSync(path.join(configPath, "init.lua")) && 
                 fs.readFileSync(path.join(configPath, "init.lua"), "utf-8").includes("packer"));
    
    hasVimPlug = fs.existsSync(path.join(configPath, "init.vim")) &&
                 fs.readFileSync(path.join(configPath, "init.vim"), "utf-8").includes("plug#begin");
  }

  // Build choices - Quick install first, then plugin managers if detected
  const choices: string[] = ["Quick install (recommended)"];
  if (hasLazy) choices.push("Use lazy.nvim (detected)");
  if (hasPacker) choices.push("Use packer.nvim (detected)");
  if (hasVimPlug) choices.push("Use vim-plug (detected)");
  choices.push("Cancel");

  const choice = await ctx.ui.select("How would you like to install?", choices);
  
  if (!choice || choice === "Cancel") return;

  if (choice.startsWith("Use lazy.nvim") || choice.startsWith("Use packer.nvim") || choice.startsWith("Use vim-plug")) {
    // Show config snippet for plugin manager users
    let snippet = "";
    if (choice.includes("lazy")) {
      snippet = `{
  "${repo}",
  config = function()
    require("pide").setup()
  end,
}`;
    } else if (choice.includes("packer")) {
      snippet = `use {
  "${repo}",
  config = function()
    require("pide").setup()
  end,
}`;
    } else if (choice.includes("vim-plug")) {
      snippet = `Plug '${repo}'`;
    }
    
    // Copy to clipboard
    try {
      const clipCmd = os.platform() === "darwin" ? "pbcopy" : 
                      os.platform() === "win32" ? "clip" : "xclip -selection clipboard";
      await pi.exec("sh", ["-c", `echo '${snippet.replace(/'/g, "'\\''")}' | ${clipCmd}`], { timeout: 5000 });
      ctx.ui.notify("✓ Config snippet copied to clipboard!", "info");
    } catch {
      ctx.ui.notify("Config snippet:", "info");
      ctx.ui.notify(snippet, "info");
    }
    
    if (choice.includes("lazy")) {
      ctx.ui.notify("Paste into your lazy.nvim plugins, then run :Lazy sync", "info");
    } else if (choice.includes("packer")) {
      ctx.ui.notify("Paste into your packer config, then run :PackerSync", "info");
    } else if (choice.includes("vim-plug")) {
      ctx.ui.notify("Paste into your init.vim, then run :PlugInstall", "info");
      ctx.ui.notify("Also add to init.lua: require('pide').setup()", "info");
    }
    
  } else if (choice === "Quick install (recommended)") {
    // Clone directly to nvim site directory
    const dataPaths = getNeovimDataPaths();
    const installPath = dataPaths[0]; // Use first (standard) path
    
    ctx.ui.notify("Installing to " + installPath + "...", "info");
    
    try {
      // Create parent directories
      const parentDir = path.dirname(installPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      // Remove old installation if exists
      if (fs.existsSync(installPath)) {
        if (os.platform() === "win32") {
          await pi.exec("rmdir", ["/s", "/q", installPath], { timeout: 5000 });
        } else {
          await pi.exec("rm", ["-rf", installPath], { timeout: 5000 });
        }
      }
      
      // Clone the repo (only the nvim-plugin subdirectory would be ideal, but git clone doesn't support that easily)
      // So we clone the whole repo and it works because lua/pide is in nvim-plugin/
      const result = await pi.exec("git", ["clone", "--depth", "1", `https://github.com/${repo}.git`, installPath], { timeout: 60000 });
      
      if (result.code !== 0) {
        throw new Error(result.stderr || "git clone failed");
      }
      
      // Move nvim-plugin contents to root
      const nvimPluginDir = path.join(installPath, "nvim-plugin");
      if (fs.existsSync(nvimPluginDir)) {
        // Copy lua directory
        const luaSrc = path.join(nvimPluginDir, "lua");
        const luaDest = path.join(installPath, "lua");
        if (fs.existsSync(luaSrc)) {
          if (os.platform() === "win32") {
            await pi.exec("xcopy", ["/E", "/I", "/Y", luaSrc, luaDest], { timeout: 5000 });
          } else {
            await pi.exec("cp", ["-r", luaSrc, luaDest], { timeout: 5000 });
          }
        }
        
        // Copy plugin directory
        const pluginSrc = path.join(nvimPluginDir, "plugin");
        const pluginDest = path.join(installPath, "plugin");
        if (fs.existsSync(pluginSrc)) {
          if (os.platform() === "win32") {
            await pi.exec("xcopy", ["/E", "/I", "/Y", pluginSrc, pluginDest], { timeout: 5000 });
          } else {
            await pi.exec("cp", ["-r", pluginSrc, pluginDest], { timeout: 5000 });
          }
        }
      }
      
      // Auto-configure init.lua
      const initLuaPath = configPath ? path.join(configPath, "init.lua") : null;
      const setupLine = "require('pide').setup()";
      let configuredInit = false;
      
      if (initLuaPath && fs.existsSync(initLuaPath)) {
        const initContent = fs.readFileSync(initLuaPath, "utf-8");
        if (!initContent.includes("pide")) {
          // Add setup line at the end
          const newContent = initContent.trimEnd() + "\n\n-- pide: IDE integration for pi\n" + setupLine + "\n";
          fs.writeFileSync(initLuaPath, newContent);
          configuredInit = true;
          ctx.ui.notify("✓ Added pide setup to " + initLuaPath, "info");
        } else {
          ctx.ui.notify("✓ pide already configured in init.lua", "info");
          configuredInit = true;
        }
      } else if (configPath) {
        // Create init.lua if it doesn't exist
        const newInitPath = path.join(configPath, "init.lua");
        if (!fs.existsSync(configPath)) {
          fs.mkdirSync(configPath, { recursive: true });
        }
        fs.writeFileSync(newInitPath, "-- pide: IDE integration for pi\n" + setupLine + "\n");
        configuredInit = true;
        ctx.ui.notify("✓ Created " + newInitPath, "info");
      }
      
      ctx.ui.notify("✓ Plugin installed!", "info");
      if (!configuredInit) {
        ctx.ui.notify("Add this to your init.lua: " + setupLine, "info");
      }
      ctx.ui.notify("Restart Neovim to activate.", "info");
      
    } catch (e) {
      ctx.ui.notify(`Failed to install: ${e}`, "error");
    }
  }
}
