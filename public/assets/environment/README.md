# Environment assets

Drop terrain tilesets, background textures, and scenery here when you have real art.

Until then the battlefield background is generated in code
(`src/game/scenes/GameScene.ts` → `drawBackdrop`), so this folder is intentionally
empty apart from this note.

Suggested layout once you add art:

```
public/assets/environment/
  grass.png          # tileable ground texture
  dirt.png           # tileable lane / road texture
  props.png + .json  # trees / rocks / bushes atlas
  keep.png           # castle / base sprite
```

When you add anything third-party, record it in the root `CREDITS.md`.
See `ASSET_SPEC.md` for the sprite contract (frame size, origin, naming, export).
