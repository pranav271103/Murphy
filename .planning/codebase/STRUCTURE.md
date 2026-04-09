# Murphy Project Structure

```bash
Murphy/
├── .planning/           # GSD planning documents
├── src/
│   ├── agent/           # Core orchestration logic
│   ├── providers/       # LLM provider integrations
│   ├── tools/           # Agent tool definitions
│   ├── types/           # TypeScript type definitions
│   ├── ui/              # Ink-based UI components
│   ├── utils/           # Shared utilities and config
│   └── index.tsx        # Application entry point
├── public/              # Static assets (icons, etc.)
├── dist/                # Compiled JS output
├── package.json         # Project manifests
└── tsconfig.json        # TypeScript configuration
```

## Key Files
- `src/index.tsx`: Main CLI entry point.
- `src/ui/App.tsx`: Root React component for the terminal interface.
- `src/utils/config.ts`: Configuration loader.
