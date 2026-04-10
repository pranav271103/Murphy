# ⚡ Operational Manual: Usage

Mastering Murphy requires understanding the interface and the execution flow.

---

## 🏎️ Launching the Interface

Once launched, you are greeted by the **Predator TUI**. This is where missions are defined and executed.

```bash
murphycode
```

### ⌨️ Tactical Keyboard Controls

| Key | Action |
| :--- | :--- |
| `Enter` | Submit mission parameters |
| `↑` / `↓` | Navigate command history |
| `ESC` | Abort current task execution |
| `Ctrl + L` | Instant screen wipe (clears UI) |
| `Ctrl + C` | Force exit predator |

---

## 📜 Mission Command Intel (Slash Commands)

Murphy supports direct tactical commands to manage the state.

| Command | Action |
| :--- | :--- |
| `/new` | Resets the agent and clears current context |
| `/clear` | Wipes only the visual message history |
| `/help` | Displays the command intelligence overview |
| `exit` | Closes the platform |

---

## 🧠 Strategic Execution Flow

When you provide a request, Murphy enters a high-speed iteration loop:

1.  **Reasoning Phase (Kimi K2)**: Strategic breakdown of your request.
2.  **Permission Step**: If a dangerous tool (disk write/shell) is needed, Murphy halts for a `[y/N]` confirmation. (1)
3.  **Execution Phase (Qwen3)**: Surgical tool usage.
4.  **Verification Phase**: Checking results to ensure mission success.

{ .annotate }

1.  **Safety First**: You can whitelist "Safe Commands" in the configuration to skip this step for read-only tasks.

---

## 🛠️ Advanced Operation: Global Access

Since Murphy v3.2, you can jump into any folder and launch:

```bash
cd /path/to/any/project
murphy
```

Murphy will automatically detect the local context and begin reconnaissance.
