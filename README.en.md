---
_file:
  created: "2026-10-29 15:08"
  updated: "2026-10-29 15:47"
  status: final
---

# DSH Sidebar

DSH Sidebar brings DeepSeek Harness conversations, tool calls, approvals and task status into VS Code. The current **Windows preview candidate is 0.1.171**, targeting exactly **DeepSeek Harness 0.2.1-rc.4**.

Detailed documentation is maintained in [Chinese](README.md). See [installation](docs/INSTALL_WINDOWS.md), [troubleshooting](docs/TROUBLESHOOTING.md) and [validation scope](docs/PREVIEW_STATUS.md).

This is an independently maintained RC4 adaptation of Lixxx1/dsh-vscode, retaining upstream MIT attribution. It is not an official DeepSeek or upstream release. Get the preview from [GitHub Releases](https://github.com/Enxulansis/dsh-sidebar/releases/tag/v0.1.171-rc4-preview.1). The extension ID remains lixxx1.dsh-sidebar for installation continuity; Marketplace builds must not be assumed to match this candidate.

This project maintains the sidebar and installation documentation. **Third-party runtime plugins are not distributed, ported or maintained.** Custom profiles and their dependencies remain the responsibility of their maintainers. The VSIX does not contain a complete backend, credentials or user data.

Requirements: Windows, VS Code 1.100+, Node.js `^22.19.0 || >=24.0.0` and the exact RC4 backend. Testing used Node.js 24.16.0. Use a separate runtime and data directory; image preparation cancellation requires the documented version-checked local runtime repair.

Normal/Plan modes are separate from read-only, workspace-write and full-access permission presets. Offline approval decisions are not automatically replayed; reconnect and confirm again.

The candidate passed 1111 unit tests, type checking and build. Native UI evidence is version-specific, as described in the validation document. No cross-platform or third-party plugin compatibility guarantee is made.

The sidebar uses the [MIT License](docs/LICENSE.md); dependencies retain their own licenses.
