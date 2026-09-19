# Avatar Candidate Batch

These are square-source avatar candidates for Team Space.

## Asset Model

- Raw/source images stay square and opaque.
- The frontend applies circular clipping at display time.
- The image files must not contain a drawn circular badge, ring, border, or medallion.

## Directory Layout

- `raw/people/*.png` and `raw/agents/*.png`: original generated square PNGs.
- `r2/avatars/presets/people/v1/<id>/<size>.webp`: people WebP derivatives in their final R2 key layout.
- `r2/avatars/presets/agents/v1/<id>/<size>.webp`: Agent WebP derivatives in their final R2 key layout.
- `r2/.../source/*.png`: normalized 512px square PNGs for review only; do not publish these to the public preset prefix.
- `preview-square-source.png`: square source preview beside each generated set manifest.
- `preview-frontend-circle-mask.png`: simulated frontend circular clipping preview beside each generated set manifest.

## Rebuild

From the repository root:

```bash
python3 scripts/build_avatar_assets.py \
  --config specs/assets/avatar-candidates/2026-07-09-square/build-avatar-assets.json
```

To replace or add avatars, update the matching `raw/<set>/` files, keep filenames sortable
(`person-01.png`, `agent-01.png`, etc.), then rerun the script.
