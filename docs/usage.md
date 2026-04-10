# Usage Guide

This guide covers the standard operation of the Murphy TUI and available command sequences.

---

## Command Line Interface

Launch Murphy from any authorized directory to begin a session.

```bash
murphycode
```

### Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| `Enter` | Submit the current input. |
| `Up` / `Down` | Navigate through previous command history. |
| `Esc` | Abort a running task or tool execution. |
| `Ctrl + L` | Clear the terminal display. |
| `Ctrl + C` | Safely terminate the application. |

---

## Built-in Commands

Murphy supports several internal commands for session management.

| Command | Action |
| :--- | :--- |
| `/new` | Resets the agent state and clears conversation context. |
| `/clear` | Clears the message history from the display. |
| `/help` | Displays a list of available tools and system information. |
| `exit` | Closes the Murphy session. |

---

## Execution Workflow

Murphy operates in an iterative loop consisting of several distinct phases:

1.  **Planning**: The strategic model (Kimi K2) analyzes the request and produces an execution plan.
2.  **Validation**: If destructive tools or shell commands are required, the user is prompted for confirmation (`[y/N]`).
3.  **Execution**: The coding model (Qwen-Coder) executes the planned tools in parallel where possible.
4.  **Reporting**: Results are streamed back to the TUI in real-time for review.

---

## Global Workspace Support

As of version 3.2, Murphy can be executed within any directory. It will automatically resolve the local path as the working directory, allowing for cross-project mobility.
