# 🛠️ Mission Targeting: Installation

Getting Murphy operational on your machine is a high-speed process. Choose your deployment vector.

---

## ⚡ Deployment Vectors

=== "NPX (Instant)"
    Run Murphy without installation:
    ```bash
    npx @pranav271103/murphycode
    ```

=== "Global CLI (Permanent)"
    Install Murphy as a system-wide threat:
    ```bash
    npm install -g @pranav271103/murphycode
    murphycode
    ```

=== "Source (Dev Mode)"
    Clone the predator for deep configuration:
    ```bash
    git clone https://github.com/pranav271103/Murphy.git
    cd Murphy
    npm install
    npm run build
    npm start
    ```

---

## 🔑 Credential Acquisition

Murphy requires an **NVIDIA NIM API Key** to fuel its dual-model brain.

1.  Navigate to [build.nvidia.com](https://build.nvidia.com/)
2.  Generate a new API Key.
3.  Inject it into your environment:

```bash
# Set locally
export NVIDIA_API_KEY=your_key_here

# Or create a .env file in the Murphy root
NVIDIA_API_KEY=your_key_here
```

!!! warning "Permission Requirement"
    Ensure your user has read/write permissions for the directory Murphy will operate in.

---

## 🖥️ System Compatibility

- **Node.js**: 18.x or higher
- **OS**: Windows (PowerShell/CMD), macOS, Linux
- **Resources**: Minimal; all heavy computation is offloaded to NVIDIA NIM.
