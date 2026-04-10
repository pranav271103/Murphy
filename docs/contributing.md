# Contributing

We welcome contributions to the Murphy project. Please follow our technical standards and guidelines.

---

## Development Environment Setup

1.  **Fork and Clone**: Fork the repository on GitHub and clone your fork locally.
2.  **Install Dependencies**: Use `npm install` to set up the development environment.
3.  **Build**: Execute `npm run build` to compile the TypeScript source into the distributable JavaScript.
4.  **Watch Mode**: Use `npm run dev` to enable hot-reloading during TUI development.

---

## Technical Standards

- **TypeScript**: All source code must be strictly typed.
- **Linting**: Run `npm run lint` to ensure your code follows the project's stylistic guidelines.
- **Formatting**: We use Prettier for code consistency. Ensure your editor is configured to use the `.prettierrc` located in the project root.

---

## Testing

Ensure all changes are verified with unit tests. We use **Vitest** for low-latency test execution.

```bash
npm test
```

Tests should cover:
- New tool handler logic.
- Agent loop state transitions.
- Path resolution and security validation.

---

## Submission Process

1.  Create a separate branch for your feature or bug fix.
2.  Maintain a clean commit history with descriptive messages.
3.  Submit a Pull Request targeting the `main` branch.
4.  Participate in the code review process to ensure high-quality integrations.
