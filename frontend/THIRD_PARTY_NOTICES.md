# Third-party component notices

## Homepage fonts and assets (2026-09-14)

- `public/assets/fonts/InterVariable.woff2`: Inter 4.1, Rasmus Andersson / Inter Project Authors.
  Source: https://rsms.me/inter/ ; license: `public/assets/fonts/Inter-LICENSE.txt` (SIL OFL 1.1).
- `public/assets/fonts/SourceHanSans-Home.woff2`: shared business UI text subset of Adobe Source Han Sans CN 2.005,
  renamed internally to **HeatSink Han** to respect the reserved font name.
  Source: https://github.com/adobe-fonts/source-han-sans/tree/release/Variable/WOFF2/TTF/Subset ;
  license: `public/assets/fonts/SourceHanSans-LICENSE.txt` (SIL OFL 1.1).
  `scripts/subset-home-font.py` takes the original font and UTF-8 UI text on stdin.
  Characters outside the subset use the declared system CJK fallback. The subset covers frontend
  Vue/TypeScript UI text; standalone presentation screens and print layouts retain their own typography.
- `public/assets/factory-inventory/ambient.png`, `stock.png`, `transit.png`: individually generated
  project assets from the earlier homepage design; the current page reuses `transit.png`.
- `public/assets/factory-inventory/*-v2.png`: individually generated project assets matching the
  user's exact reselected image, including eight distinct team equipment illustrations, a stock
  cube and the blue/lilac background. Source reference and generation brief are recorded in
  `../docs/design-references/factory-inventory-v2-assets.md`. Sidebar and control symbols remain
  from the existing Element Plus Icons library; the page itself is live HTML, not a mockup image.
- `public/assets/factory-inventory/ambient-white-purple.png`: built-in Image Gen color edit of
  `ambient-v2.png`, preserving composition and replacing blue/cyan with pearl white and lavender.
  This is the local white-purple trial requested after the blue-purple deployment; final prompt
  and scope are recorded in `../docs/design-references/factory-inventory-white-purple.md`.
- `src/components/motion/InventoryAmbient.vue` uses the existing MIT-licensed Three.js runtime to
  animate the pale background image, capped at 24 renders/second and one canvas. Visibility,
  pause, reduced-motion and unmount release/pause its resources; the image is the WebGL fallback.

## Current homepage motion components (2026-09-14)

`src/components/motion/SpotlightCard.vue` and `StarBorder.vue` are adapted from Vue Bits,
commit `66c1d9024337c718ae78928b0b92901fd9fbb0cf`:

- https://github.com/DavidHDev/vue-bits/blob/66c1d9024337c718ae78928b0b92901fd9fbb0cf/src/content/Components/SpotlightCard/SpotlightCard.vue
- https://github.com/DavidHDev/vue-bits/blob/66c1d9024337c718ae78928b0b92901fd9fbb0cf/src/content/Animations/StarBorder/StarBorder.vue

Changes: scoped CSS in place of Tailwind, light-theme colors and compact dimensions,
keyboard focus-within, touch-safe spotlight, page visibility/pause/reduced-motion controls.
Only these component sources are incorporated; no Svelte runtime, Tailwind reset or
GSAP is added. The homepage reuses the existing Three.js dependency separately.
The license below applies to both adaptations.

Historical releases used a Vue Bits StarBorder component (removed from the current
screen in the 2026-09-12 table redesign). Its retained historical notice follows:
https://github.com/DavidHDev/vue-bits/blob/main/src/content/Animations/StarBorder/StarBorder.vue

Changes: Tailwind utilities converted to scoped CSS, non-interactive container,
project colors, pause and reduced-motion support. No Svelte runtime is included.

## Vue Bits — MIT + Commons Clause License Condition v1.0

Copyright (c) 2025 David Haz

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, and distribute the Software as part of an application, website, or product, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

### Commons Clause Restriction

You may use this Software, including for any commercial purpose, so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, template, or as a ported version.

### No Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

License source: https://github.com/DavidHDev/vue-bits/blob/main/LICENSE.md
# RobotExpressive animation rig

`public/assets/factory-live/robot-expressive.glb`: RobotExpressive by Tomás Laulhé
(Quaternius), with modifications by Don McCurdy. CC0 1.0 Universal.
Source: https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive
License: https://creativecommons.org/publicdomain/zero/1.0/
The dashboard uses its skeleton and animation clips with project-specific rounded
cladding, materials and a tray-constrained arm pose. Three.js is MIT-licensed.
