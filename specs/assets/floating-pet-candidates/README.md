# Floating Pet Candidates

Version: `0.2.34_desktop_pet_settings`

This folder contains single-icon Mino desktop-pet candidates for choosing future built-in presets. The visual direction comes from image-gen reference art, while the final Codex Pets atlases were rebuilt deterministically so every used cell contains one complete centered icon and every unused cell is transparent.

Each candidate folder contains:

- `pet.json` — Codex Pets compatible manifest.
- `spritesheet.webp` — 1536 x 1872 transparent atlas, 8 columns x 9 rows.
- `contact-sheet.png` — hatch-pet contact sheet for quick visual review.
- `validation.json` — output from `hatch-pet/scripts/validate_atlas.py`.

All 11 candidates pass `validate_atlas.py` with zero errors and zero warnings. Matching packages are also copied to local Codex/MyAgents pet libraries for manual import testing.

## Candidates

| ID | Direction |
| --- | --- |
| `mino-folder-spark` | Baseline living folder, closest to the current Mino visual. |
| `mino-memory-capsule` | Archive capsule and memory-card accents. |
| `mino-terminal-cube` | Terminal-screen companion with a stronger hacker-workbench tone. |
| `mino-cloud-sync` | Cloud + Git branch continuity across machines. |
| `mino-workbench` | Practical tiny desk companion. |
| `mino-compass` | Directional, decisive compass body. |
| `mino-context-lantern` | Context illumination and low-noise focus. |
| `mino-prism-notebook` | Notebook plus prism, memory with judgment. |
| `mino-signal-tower` | Attention/context routing signal tower. |
| `mino-seedling-folder` | Growing folder, closest to “Always Evolving”. |
| `mino-mono-orb-folder` | Quiet low-saturation orb-folder hybrid. |

## QA

```bash
ROOT=specs/assets/floating-pet-candidates
for dir in "$ROOT"/mino-*; do
  python .agents/skills/hatch-pet/scripts/validate_atlas.py "$dir/spritesheet.webp" --json-out "$dir/validation.json"
  python .agents/skills/hatch-pet/scripts/make_contact_sheet.py "$dir/spritesheet.webp" --output "$dir/contact-sheet.png" --scale 0.5
done
```

`overview.png` is a stitched visual index of the candidate idle icons.
