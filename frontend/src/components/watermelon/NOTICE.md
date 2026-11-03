# Watermelon Vue components

These local Vue components adapt Watermelon's React source with `motion-v`; it is not an
official Watermelon Vue package. Warehouse filtering and saves use the existing API and permissions.

- `WatermelonFilter.vue`: Filter Disclosure's spring reveal, staggered choices and shared
  selection check. `WatermelonSegmented.vue`: Fluid Tabs' floating active indicator.
  `WatermelonWarehouseToolbar.vue` composes these controls with warehouse options.
- `WatermelonSearch.vue` and `WatermelonSwitch.vue` extract the native input and
  toggle behavior for reuse; these are local components, not additional upstream ports.
- `WatermelonDialog.vue` / warehouse editor / `WatermelonButton.vue`: Edit Profile's muted
  outer shell, white inset body, split field/preview layout, black pill action, input borders
  and spring settings (300 stiffness / 20 damping / 0.8 mass). Profile fields become warehouse
  fields; the native HTML dialog adds focus containment and Escape behavior.
- `WatermelonPagination.vue`: Continuous Pagination's shared active background and spring
  interaction. Buttons are 32px for warehouse density; the infinite decorative shimmer is omitted.
- Warehouse cells remain a business-specific layout; they are not claimed to be a stock
  Watermelon warehouse component. No remote images or tracking resources are loaded.

- https://ui.watermelon.sh/animated-components/filter-disclosure
- https://ui.watermelon.sh/animated-components/fluid-tabs
- https://ui.watermelon.sh/animated-components/edit-profile
- https://ui.watermelon.sh/animated-components/continuous-pagination
- https://github.com/WatermelonCorp/watermelon-platform

## Upstream license

MIT License

Copyright (c) 2026 Watermelon Platform Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
