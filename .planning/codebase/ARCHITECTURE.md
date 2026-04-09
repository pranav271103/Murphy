# Murphy Architecture

## System Overview
Murphy is a CLI-based agentic platform. It separates the **Brain** (Agent Logic) from the **Body** (Tools and UI).

## Core Layers

### 1. Orchestration Layer (`src/agent/loop.ts`)
The **"Predator Brain"**. Features include:
- **Dual-Model Pipeline**: Kimi K2 for iteration 1 (reasoning), Qwen3 for subsequent iterations (execution).
- **Parallel Pipeline**: Executes tool calls concurrently via `Promise.all`.
- **Unbreakable Engine**: A text-to-tool parser that extracts tool calls from malformed LLM responses using regex patterns (XML, Markdown, JSON-like).
- **Auto-Recovery**: Exponential backoff and retry logic for tool failures.

### 2. Provider Layer (`src/providers/nvidia.ts`)
Surgical model orchestration over NVIDIA NIM:
- **Client Pooling**: Separate OpenAI clients for Kimi and Qwen models.
- **Request Cache**: Deduplication of identical non-streaming requests.
- **Precision Streaming**: Accumulates partial tool calls from model streams.

### 3. Tool Layer (`src/tools/index.ts`)
The **"Predator's Arsenal"**. Surgical file operations, spawn-based command execution (avoiding `exec` shell overhead), and glob-based searching.

### 4. UI Layer (`src/ui/`)
React/Ink components that provide real-time feedback (spinners, progress bars, gradients).

## Data Flow
1. User Command → `src/index.tsx`
2. `App.tsx` (UI) initializes and starts the agent.
3. `Agent` queries LLM via `Providers`.
4. `LLM` returns thoughts/tool calls.
5. `Agent` executes `Tools`.
6. Results pushed to `UI`.
7. Repeat until task complete.
