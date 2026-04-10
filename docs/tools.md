# Tool Reference

Murphy utilizes a suite of verified tools to interact with the local file system and the web.

---

## File System Tools

| Tool | Description | Parameters |
| :--- | :--- | :--- |
| `read_file` | Reads file content with optional line-based pagination. | `path`, `offset`, `limit` |
| `write_file` | Writes content to a file, creating directories as needed. | `path`, `content` |
| `edit_file` | Performs a surgical search-and-replace on a targeted string. | `path`, `old_string`, `new_string` |
| `delete_file` | Removes a specified file from the system. | `path` |
| `list_directory` | Lists directory contents with recursive support. | `path`, `recursive`, `pattern` |
| `create_directory` | Creates a new directory or nested directory structure. | `path` |

---

## System Integration

### run_command
Executes shell commands within the host environment. On Windows systems, Murphy defaults to **PowerShell** for enhanced security and functionality.

- **Timeouts**: Configurable execution limits to prevent hanging processes.
- **Resource Management**: Truncates large outputs to maintain context window stability.
- **Interruption**: Fully integrated with the `AbortSignal` API for safe process termination.

---

## Code Intelligence Tools

### grep
Searches for text patterns using optimized filesystem traversal. Ideal for finding references or function definitions across large codebases.

### glob
Discovers files matching specific patterns (e.g., `src/**/*.ts`).

---

## Network Utilities

### fetch_url
Retrieves content from public URLs. This is used for reading external documentation or fetching remote assets.
- **Security**: Implements SSRF protection by blocking requests to local or private network addresses.

---

## Security and Confirmation

By default, Murphy requires explicit user confirmation for any destructive or system-level operation (such as `run_command` or `delete_file`). Users can configure an allowlist to skip this prompt for trusted commands.
