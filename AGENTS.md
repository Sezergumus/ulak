# Workspace instructions

Before continuing work, read [HANDOFF.md](HANDOFF.md), [context.md](context.md), and [docs/phase-status.md](docs/phase-status.md). Confirm the current Git state rather than assuming the recorded commit is still HEAD.

- Keep all file changes, build output, temporary files, runtime fixtures, and tool caches inside this workspace. Do not change global system settings or global Git configuration. Use the workspace-contained Rust scripts.
- Keep source comments, documentation, and commit messages in English. User-facing conversation may remain in Turkish. Use product and engineering terminology without tool/model or authoring-process attribution.
- Commit each meaningful, verified change separately with a descriptive English commit message. Preserve unrelated user changes.
- Keep implementation and measured validation distinct. Never mark physical-device, Explorer, or large-transfer acceptance checks passed without actually exercising them.
- Follow the architecture contract, especially explicit share audiences, persistent device identity, bounded streaming, source references without staging, and platform-specific destination guarantees.
- The user explicitly requested phase 4, and its desktop/CLI implementation is present. Hardware, native dialog, Explorer, and tray interaction checks remain open as recorded in the handoff. Phase 5 has not been requested; resume according to the user's next instruction.
