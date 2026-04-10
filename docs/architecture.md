# Architecture

Murphy is built on a modular, dual-model architecture designed to separate high-level reasoning from low-level code implementation.

---

## Dual-Model System

Traditional AI agents often suffer from "reasoning decay" when tasked with simultaneous planning and coding. Murphy mitigates this by assigning these tasks to specialized models.

### Strategic Planning (Kimi K2)
Kimi K2 serves as the orchestrator. It specializes in large-context processing and logical decomposition of complex requests.
- **Role**: Plan generation, dependency analysis, and context management.
- **Context Handling**: Optimized for deep codebase exploration.

### Code Implementation (Qwen-Coder)
Qwen-Coder is the specialized execution model. It translates orchestrator plans into validated tool calls.
- **Role**: Code generation, file editing, and command execution.
- **Performance**: High-speed token generation with standard tool-calling support.

---

## The Execution Pipeline

Murphy uses an asynchronous, parallelized pipeline to execute system operations.

### Parallelization
Multiple I/O-bound operations (such as reading several files or searching directories) are executed concurrently using `Promise.all`. This significantly reduces the total latency of multi-file refactoring tasks.

### Redundant Parsing
In cases where a model produces malformed tool parameters, Murphy activates a secondary regex-based parser. This ensures the execution loop remains online even when the API response deviates from the expected schema.

---

## State and Persistence

Murphy implements session persistence using atomic file operations. 
- **Session Data**: Stored in `.murphy_session.json`.
- **Integrity**: Files are written to temporary locations first and moved to the final destination to prevent data corruption during crashes.
- **Context Window**: History is automatically pruned to keep the token count within optimal processing limits.

---

## Frontend Technology
The TUI is built using **React** and **Ink**, providing a reactive component-based UI inside the terminal environment. A global **Error Boundary** is implemented to catch and isolate UI-level exceptions.
