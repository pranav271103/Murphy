# 🔨 Tactical Tools: The Arsenal

Murphy is equipped with a high-performance toolset for project manipulation.

---

## 📂 File System Operations

| Tool | Capability | Parameters |
| :--- | :--- | :--- |
| `read_file` | High-speed content retrieval | `path`, `offset`, `limit` |
| `write_file` | Atomic file creation | `path`, `content` |
| `edit_file` | Surgical code replacement | `path`, `old_string`, `new_string` |
| `delete_file` | Target termination | `path` |
| `list_directory` | Reconnaissance | `path`, `recursive`, `pattern` |
| `create_directory` | Base expansion | `path` |

---

## ⚙️ System Control

### `run_command`
The primary tool for execution. In Windows missions, Murphy automatically selects **PowerShell** for maximum compatibility.

- **Timeout**: Hard cap of 2 minutes (configurable).
- **Hardening**: Prevents OOM by truncating massive outputs.
- **Interruption**: Linked to `AbortSignal` for instant cancellation.

---

## 🔍 Intelligence Gathering

### `grep` & `glob`
Standard searching is too slow. Murphy uses optimized pattern matching to find targets across thousands of files in milliseconds.

### `fetch_url`
Web-enabled reconnaissance. Use this to read documentation from the web or fetch external assets.
- **SSRF Protected**: Explicitly blocks access to internal networks.

---

## 🚦 Safety Protocols

Every tool call is wrapped in a **Permission Layer**.
!!! danger "Destructive Action"
    Actions like `delete_file` or `run_command` will ALWAYS prompt for a `[y/N]` confirmation unless configured otherwise.
    ```bash
    ⚠️ PERMISSION REQUIRED: run_command
    {"command": "rm -rf ./"}
    Allow? [Y]es / [N]o
    ```
