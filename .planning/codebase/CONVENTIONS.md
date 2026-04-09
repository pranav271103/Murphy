# Murphy Conventions

- **Surgical Logic**: Favoring precision and directness in tool usage.
- **Loop Protection**: Text-to-tool fallback ensures continuity if structured parsing fails.
- **Evolutionary Markers**: "Predator Evolution Step X" markers track design iterations in the source.
- **Performance**: Heavy use of `perf_hooks` for telemetry and `Promise.all` for parallel tool execution.
- **TypeScript**: Strict mode, ESM-only.
- **UI**: Ink for terminal feedback, using `ink-gradient` for surgical headers.
