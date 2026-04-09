# Murphy Stack

- **Runtime**: Node.js >= 18.0.0
- **Language**: TypeScript ^5.4.5
- **Package Manager**: npm
- **UI Engine**: Ink ^5.0.1 (React-based CLI UI)
- **LLM SDK**: OpenAI ^4.47.1 (Interface for NVIDIA NIM)
- **Primary Models**:
  - `moonshotai/kimi-k2-thinking` (Reasoning/Planning)
  - `qwen/qwen3-coder-480b-a35b-instruct` (Execution/Coding)
- **Validation**: Zod ^3.23.8
- **Runner**: tsx ^4.21.0
- **Formatting**: Prettier, ESLint

## Integration Points
- **NPM Package Registry**: `@pranav271103/murphycode`
- **Git**: GitHub (authenticated via GH CLI recommended for shipping)
