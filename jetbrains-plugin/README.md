# Pi IDE Integration for JetBrains

Sends your current file and selection to [pi](https://github.com/badlogic/pi-mono) coding agent.

Works with all JetBrains IDEs: IntelliJ IDEA, GoLand, WebStorm, PyCharm, CLion, Rider, RubyMine, PhpStorm, Android Studio, DataGrip.

## Building

Requires JDK 17+.

```bash
# Build the plugin
./gradlew buildPlugin

# The plugin zip will be at:
# build/distributions/pide-jetbrains-0.1.0.zip
```

## Installing

1. Build the plugin (see above)
2. In your JetBrains IDE: **Settings → Plugins → ⚙️ → Install Plugin from Disk...**
3. Select `build/distributions/pide-jetbrains-0.1.0.zip`
4. Restart the IDE

## Usage

1. Open pi in a terminal
2. Select code in your JetBrains IDE → the selection appears in pi's footer
3. Press `Ctrl+I` in pi to insert the file reference

## How it works

The plugin writes selection data to `~/.pi/ide-selection.json` whenever you:
- Open a file
- Select code
- Change files

All running pi instances watch this file and display the current selection.
