-- pide.nvim - IDE Integration for pi
-- Syncs current file/selection to pi coding agent

local M = {}

local config = {
  auto_send = true,
  debounce_ms = 100,
  clear_on_exit = true,
}

local selection_file = vim.fn.expand("~/.pi/ide-selection.json")
local debounce_timer = nil

-- Ensure ~/.pi directory exists
local function ensure_dir()
  local dir = vim.fn.expand("~/.pi")
  if vim.fn.isdirectory(dir) == 0 then
    vim.fn.mkdir(dir, "p")
  end
end

-- Get visual selection text and range
local function get_visual_selection()
  -- Check if we're in visual mode
  local mode = vim.fn.mode()
  if mode ~= "v" and mode ~= "V" and mode ~= "\22" then
    return nil
  end

  -- Get visual selection marks
  local start_pos = vim.fn.getpos("v")
  local end_pos = vim.fn.getpos(".")

  local start_line = start_pos[2]
  local end_line = end_pos[2]

  -- Ensure start < end
  if start_line > end_line then
    start_line, end_line = end_line, start_line
  end

  -- Get the text
  local lines = vim.fn.getline(start_line, end_line)
  if type(lines) == "string" then
    lines = { lines }
  end

  return {
    text = table.concat(lines, "\n"),
    start_line = start_line,
    end_line = end_line,
  }
end

-- Get the last visual selection (for use after leaving visual mode)
local function get_last_visual_selection()
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")

  -- Check if marks are valid
  if start_pos[2] == 0 or end_pos[2] == 0 then
    return nil
  end

  local start_line = start_pos[2]
  local end_line = end_pos[2]

  local lines = vim.fn.getline(start_line, end_line)
  if type(lines) == "string" then
    lines = { lines }
  end

  return {
    text = table.concat(lines, "\n"),
    start_line = start_line,
    end_line = end_line,
  }
end

-- Send current file/selection to pi
local function send_selection(opts)
  opts = opts or {}
  local immediate = opts.immediate or false
  local use_last_visual = opts.use_last_visual or false

  -- Cancel pending debounce
  if debounce_timer then
    vim.fn.timer_stop(debounce_timer)
    debounce_timer = nil
  end

  local function do_send()
    local file = vim.fn.expand("%:p")
    if file == "" then
      M.clear_selection()
      return
    end

    local data = {
      file = file,
      ide = "neovim",
      timestamp = os.time() * 1000,
    }

    -- Try to get visual selection
    local selection = nil
    if use_last_visual then
      selection = get_last_visual_selection()
    else
      selection = get_visual_selection()
    end

    if selection then
      data.selection = selection.text
      data.startLine = selection.start_line
      data.endLine = selection.end_line
    end

    -- Write to file
    ensure_dir()
    local json = vim.fn.json_encode(data)
    local ok, err = pcall(function()
      vim.fn.writefile({ json }, selection_file)
    end)

    if not ok then
      vim.notify("pide: Failed to write selection: " .. tostring(err), vim.log.levels.ERROR)
    end
  end

  if immediate then
    do_send()
  else
    debounce_timer = vim.fn.timer_start(config.debounce_ms, function()
      vim.schedule(do_send)
    end)
  end
end

-- Clear the selection file
function M.clear_selection()
  if vim.fn.filereadable(selection_file) == 1 then
    pcall(vim.fn.delete, selection_file)
  end
end

-- Send selection command (for manual trigger)
function M.send()
  send_selection({ immediate = true, use_last_visual = true })
  vim.notify("pide: Selection sent to pi", vim.log.levels.INFO)
end

-- Setup the plugin
function M.setup(opts)
  opts = opts or {}
  config = vim.tbl_deep_extend("force", config, opts)

  -- Create user commands
  vim.api.nvim_create_user_command("PideSend", function()
    M.send()
  end, { desc = "Send current file/selection to pi" })

  vim.api.nvim_create_user_command("PideClear", function()
    M.clear_selection()
    vim.notify("pide: Selection cleared", vim.log.levels.INFO)
  end, { desc = "Clear pi selection" })

  if config.auto_send then
    local group = vim.api.nvim_create_augroup("pide", { clear = true })

    -- Send on cursor movement and buffer changes
    vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI", "BufEnter", "FocusGained" }, {
      group = group,
      callback = function()
        send_selection({ immediate = false })
      end,
      desc = "pide: auto-send on cursor move",
    })

    -- Send with last visual selection when leaving visual mode
    vim.api.nvim_create_autocmd("ModeChanged", {
      group = group,
      pattern = { "[vV\x16]*:*" },
      callback = function()
        -- Small delay to ensure '< and '> marks are set
        vim.defer_fn(function()
          send_selection({ immediate = true, use_last_visual = true })
        end, 10)
      end,
      desc = "pide: send selection when leaving visual mode",
    })

    -- Clear on exit
    if config.clear_on_exit then
      vim.api.nvim_create_autocmd("VimLeavePre", {
        group = group,
        callback = function()
          M.clear_selection()
        end,
        desc = "pide: clear selection on exit",
      })
    end

    -- Initial send
    vim.defer_fn(function()
      send_selection({ immediate = true })
    end, 100)
  end
end

return M
