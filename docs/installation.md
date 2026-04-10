# Installation

Murphy can be deployed using several different methods depending on your environment and requirements.

---

## Deployment Options

### NPX (On-demand)
The fastest way to use Murphy without persistent installation is via npx:
```bash
npx @pranav271103/murphycode
```

### Global CLI
To install Murphy as a global command on your system:
```bash
npm install -g @pranav271103/murphycode
murphycode
```

### From Source
For development or custom configurations, clone the repository and build from source:
```bash
git clone https://github.com/pranav271103/Murphy.git
cd Murphy
npm install
npm run build
npm start
```

---

## Configuration

Murphy requires an NVIDIA NIM API key to access the underlying models.

1.  Obtain an API key from the [NVIDIA NIM console](https://build.nvidia.com/).
2.  Set the `NVIDIA_API_KEY` environment variable:

```bash
# Unix-like (Bash/Zsh)
export NVIDIA_API_KEY="your_api_key"

# Windows (PowerShell)
$env:NVIDIA_API_KEY="your_api_key"
```

Alternately, you can create a `.env` file in your working directory:
```text
NVIDIA_API_KEY=your_api_key
```

---

## Technical Requirements

- **Node.js**: Version 18.0.0 or later.
- **Git**: Required for version control operations.
- **Operating System**: Compatible with Windows, macOS, and Linux.
