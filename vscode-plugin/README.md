# Pi IDE Integration for VS Code

Sends your current file and selection to [pi](https://github.com/badlogic/pi-mono) coding agent.

## Features

- Automatically sends selection changes to pi
- Works with multiple pi terminals (file-based communication)
- Commands to manually send or clear selection

## Usage

1. Install the extension
2. Open pi in a terminal
3. Select code in VS Code → it appears in pi's widget
4. Use `/ide` command in pi to insert selection into your prompt

## Commands

| Command | Description |
|---------|-------------|
| `Pi: Send Selection to Pi` | Manually send current selection |
| `Pi: Clear Pi Selection` | Clear the current selection |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `pide.autoSend` | `true` | Automatically send selection changes |
| `pide.debounceMs` | `100` | Debounce delay in milliseconds |

## How it works

The extension writes selection data to `~/.pi/ide-selection.json`. All running pi instances watch this file and show the selection in their UI.
