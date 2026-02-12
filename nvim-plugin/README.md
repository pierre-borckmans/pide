# pide.nvim

Neovim plugin for [pide](https://github.com/pierre-borckmans/pide) - IDE integration for [pi](https://github.com/badlogic/pi-mono) coding agent.

Automatically syncs your current file and visual selection to pi.

## Installation

### Using [lazy.nvim](https://github.com/folke/lazy.nvim)

```lua
{
  "pierre-borckmans/pide",
  config = function()
    require("pide").setup()
  end,
  -- Or with custom options:
  -- config = function()
  --   require("pide").setup({
  --     auto_send = true,      -- Auto-send on cursor move (default: true)
  --     debounce_ms = 100,     -- Debounce delay in ms (default: 100)
  --     clear_on_exit = true,  -- Clear selection when exiting nvim (default: true)
  --   })
  -- end,
}
```

### Using [packer.nvim](https://github.com/wbthomason/packer.nvim)

```lua
use {
  "pierre-borckmans/pide",
  config = function()
    require("pide").setup()
  end,
}
```

### Using [vim-plug](https://github.com/junegunn/vim-plug)

```vim
Plug 'pierre-borckmans/pide'

" In your init.lua or after/plugin/pide.lua:
lua require("pide").setup()
```

### Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/pierre-borckmans/pide ~/.local/share/nvim/site/pack/pide/start/pide
   ```

2. Add to your config:
   ```lua
   require("pide").setup()
   ```

## Usage

Once installed, the plugin automatically:

1. **Sends the current file** to pi when you switch buffers or move the cursor
2. **Sends visual selections** when you select text and leave visual mode

In pi, press `Ctrl+;` to reference the current selection.

### Commands

| Command | Description |
|---------|-------------|
| `:PideSend` | Manually send current file/selection to pi |
| `:PideClear` | Clear the current selection |

### Configuration

```lua
require("pide").setup({
  -- Automatically send file/selection on cursor move
  auto_send = true,

  -- Debounce delay for auto-send (milliseconds)
  debounce_ms = 100,

  -- Clear selection file when exiting Neovim
  clear_on_exit = true,
})
```

## How It Works

The plugin writes selection info to `~/.pi/ide-selection.json`:

```json
{
  "file": "/path/to/file.lua",
  "selection": "selected text",
  "startLine": 10,
  "endLine": 15,
  "ide": "neovim",
  "timestamp": 1707570000000
}
```

All running pi instances watch this file and show the selection status.

## License

MIT
