# icons/

Tauri requires application icons for both the dev runtime (tray) and the
bundler (installer + .exe metadata). Phase 2 scaffold does **not** ship
real icons — they must be generated before the first `pnpm tauri build`
and before a runnable tray icon shows on the taskbar.

## Required files (per `../tauri.conf.json`)

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`   (high-DPI)
- `icon.ico`         (Windows multi-resolution: 16, 32, 48, 256)
- `icon.icns`        (macOS — unused for popo Windows-only v0.1, but
                     Tauri expects it to exist or errors during bundle)
- `icon.png`         (the tray icon referenced by tauri.conf.json)

## How to generate (once a source logo SVG / 1024×1024 PNG exists)

```sh
pnpm tauri icon path/to/popo-mark.png
```

This regenerates every size from the source. Re-run whenever the logo
mark changes.

## Design direction for the mark

Per `docs/DESIGN_SYSTEM.md` the popo glyph is "a custom small SVG: 3
vertical bars of different heights suggesting a waveform, 16px wide,
`--text-ghost` on dark". A square rendering at 1024×1024 with the mark
centered and padded to ~60% of the canvas is the intended source.

## Temporary workaround

If `pnpm tauri dev` refuses to launch with "missing icon" during Phase 2
scaffold, copy any 32×32 PNG into this directory as `32x32.png` and any
valid `.ico` as `icon.ico`. Dev mode is more permissive than bundle.
