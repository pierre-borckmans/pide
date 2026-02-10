import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SELECTION_FILE = path.join(os.homedir(), ".pi", "ide-selection.json");

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

interface SelectionData {
  file: string;
  selection?: string;
  startLine?: number;
  endLine?: number;
  ide: string;
  timestamp: number;
}

function ensureDir() {
  const dir = path.dirname(SELECTION_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sendSelection(immediate = false) {
  const config = vscode.workspace.getConfiguration("pide");
  const debounceMs = config.get<number>("debounceMs", 100);

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const doSend = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      // No editor, clear selection
      clearSelection();
      return;
    }

    const selection = editor.selection;
    const document = editor.document;

    const data: SelectionData = {
      file: document.uri.fsPath,
      ide: "vscode",
      timestamp: Date.now(),
    };

    if (!selection.isEmpty) {
      data.selection = document.getText(selection);
      data.startLine = selection.start.line + 1;
      data.endLine = selection.end.line + 1;
    }

    try {
      ensureDir();
      fs.writeFileSync(SELECTION_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error("pide: Failed to write selection file:", e);
    }
  };

  if (immediate) {
    doSend();
  } else {
    debounceTimer = setTimeout(doSend, debounceMs);
  }
}

function clearSelection() {
  try {
    if (fs.existsSync(SELECTION_FILE)) {
      fs.unlinkSync(SELECTION_FILE);
    }
  } catch (e) {
    console.error("pide: Failed to clear selection file:", e);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("pide: Extension activated");

  const config = vscode.workspace.getConfiguration("pide");
  const autoSend = config.get<boolean>("autoSend", true);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("pide.sendSelection", () => {
      sendSelection(true);
      vscode.window.showInformationMessage("Selection sent to pi");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pide.clearSelection", () => {
      clearSelection();
      vscode.window.showInformationMessage("Pi selection cleared");
    })
  );

  if (autoSend) {
    // Auto-send on selection change
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(() => {
        sendSelection();
      })
    );

    // Auto-send on active editor change
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        sendSelection();
      })
    );

    // Initial send
    sendSelection(true);
  }

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
      if (e.affectsConfiguration("pide")) {
        vscode.window.showInformationMessage(
          "Pi IDE settings changed. Reload window for full effect."
        );
      }
    })
  );
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  // Optionally clear selection on deactivate
  // clearSelection();
}
