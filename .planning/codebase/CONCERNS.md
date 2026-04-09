# Murphy Concerns & Tech Debt

- **Fallback Sensitivity**: Text-to-tool regex might need expansion for edge-case LLM formats.
- **Context Depth**: Dual-model history management to avoid token overflow.
- **Tool Timeouts**: Long-running commands (e.g. `npm install`) need robust child-process management.
- **UI Locking**: Ensure Ink doesn't swallow critical errors before they can be logged.
