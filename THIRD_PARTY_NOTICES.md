# Third-party notices

- **Sign in with ChatGPT DevKit:** OpenAI, Noncommercial License 1.0. The source and license are under `apps/desktop/vendor/siwc-devkit`. Use, modification, and distribution of that contribution are limited to noncommercial purposes. Commercial use requires separate written permission from OpenAI. Preserve the included notices and changed-file requirements if distributing a modified work.
- **React, React DOM, Electron, Vite, electron-vite, TypeScript, Vitest, and electron-builder:** licenses and versions are recorded in `apps/desktop/package-lock.json` and each installed package's license file.
- **Python worker:** uses the Python standard library; no third-party Python package is required.
- **Gameplay montage pipeline:** source code from [`gustavomenani/editing-gameplay-montages`](https://github.com/gustavomenani/editing-gameplay-montages), pinned at `bd016ee02ac3d667f6849a136ab5f69edbd0edec`, is included under `third_party/editing-gameplay-montages` and licensed under MIT. The RIFE v4.25 ncnn/Vulkan model is included from that pinned repository; its `flownet.bin` SHA-256 is `10de487a095e61cb2971c39e3b5e17005a70fba6201c77fb96e063f4423b583f`. Preserve the upstream license when redistributing.
- **Upstream Python runtime:** optional local integration uses the exact versions in `third_party/editing-gameplay-montages/skills/editing-gameplay-montages/scripts/requirements.txt`; it is installed separately into the user data folder by `scripts/setup-upstream.ps1`.
- **FFmpeg/FFprobe:** supplied or installed separately by the user; this repository does not bundle or redistribute the binaries. FFmpeg build features and licenses vary. Verify the license of a selected Windows build, especially if it includes GPL components such as `libx264`.

OpenAI names and marks remain subject to their applicable trademark and brand rules. The application does not imply account eligibility, unlimited ChatGPT plan usage, or standard API billing.
