# Watermelon Vue components

These local Vue components adapt Watermelon's React source with `motion-v`; it is not an
official Watermelon Vue package. Warehouse filtering and saves use the existing API and permissions.

- `WatermelonFilter.vue`: Filter Disclosure's spring reveal, staggered choices and shared
  selection check. `WatermelonSegmented.vue`: Fluid Tabs' floating active indicator.
  `WatermelonWarehouseToolbar.vue` composes these controls with warehouse options.
- `WatermelonSearch.vue` and `WatermelonSwitch.vue` extract the native input and
  toggle behavior for reuse; these are local components, not additional upstream ports.
- `WatermelonDialog.vue` / warehouse editor / `WatermelonButton.vue`: Edit Profile's muted
  outer shell, white inset body, black pill action, input borders
  and spring settings (300 stiffness / 20 damping / 0.8 mass). Profile fields become warehouse
  fields; the compact warehouse form omits the profile preview column. The native HTML dialog
  adds focus containment and Escape behavior. The backdrop fades separately, matching the
  reference entrance; the exit is shortened to 150ms for repeated warehouse operations.
  Button loading uses a local, width-preserving label/spinner transition driven by API state.
- `WatermelonPagination.vue`: DataTable 11's current-page/total-page label, centered numbered
  outline/ghost buttons, ellipses and right-aligned page-size control. Keeps the existing
  Vue events and reduced-motion behavior. Its footer shares the warehouse card rather than
  repeating the upstream demo's separate footer frame.
- `WatermelonDataTable.vue`: DataTable 11's 48px header, 14px vertical cell padding,
  medium-weight primary fields, horizontal separators and borderless colored status pills.
  Element Plus provides the existing Vue table engine and fixed-column behavior. The shared
  `embedded` option removes the extra table frame inside a data card; standalone detail
  tables retain their rounded frame. Business field definitions and server pagination remain
  local. The demo's client-only sorting is not applied to the joined server-paged warehouse list.
- `watermelon.css`: scoped light/dark tokens based on system appearance. The warehouse
  sidebar retains its navigation structure; only its palette matches the table theme.
  No remote images or tracking resources are loaded.
- `WatermelonDateInput.vue`: Schedule Date's rounded calendar, selected-day indicator and
  spring feedback adapted to a single date. Element Plus retains parsing, keyboard navigation,
  clearing and disabled dates; the upstream range-selection behavior is not copied.
- `AppNumberInput.vue`: uses Floating Input's border and focus transition with local
  plus/minus press feedback. Existing external form labels remain in place; this is not a
  floating-label port. Element Plus retains precision, bounds and numeric keyboard behavior.
- `WatermelonNotice.vue`: Inline Toast's icon/message composition and spring entrance,
  adapted to persistent validation feedback. Global messages keep Element Plus's grouping
  and dismissal engine with the matching palette. No copy action or demo timers are included.
- `forms.css`: Form 10's consistent input/select/textarea treatment, subtle inset edges,
  focus ring and inline error surface; Select 21's neutral popover, rounded options and
  selection check. Warehouse controls use a shared 40px height rather than the example's
  32px height. The Vue input and select engines retain their existing business bindings.
- `ScheduleBatchSummary.vue`: Meeting Card's muted header, grouped quantities and footer
  actions, adapted with compact plain date rows. The body uses the same spring settings (300 stiffness /
  30 damping) for height and opacity, with reduced-motion support. Scheduling details open
  on click through the existing `AppPopover`; business quantities and dates remain local.
  https://ui.watermelon.sh/animated-components/meeting-card
  https://registry.watermelon.sh/r/meeting-card.json

- https://ui.watermelon.sh/animated-components/filter-disclosure
- https://ui.watermelon.sh/animated-components/fluid-tabs
- https://ui.watermelon.sh/animated-components/edit-profile
- https://ui.watermelon.sh/components/data-table (DataTable 11)
- https://registry.watermelon.sh/r/data-table-11.json
- https://ui.watermelon.sh/animated-components/schedule-date
- https://registry.watermelon.sh/r/schedule-date.json
- https://ui.watermelon.sh/animated-components/floating-input
- https://registry.watermelon.sh/r/floating-input.json
- https://ui.watermelon.sh/animated-components/inline-toast
- https://registry.watermelon.sh/r/inline-toast.json
- https://ui.watermelon.sh/components/form
- https://registry.watermelon.sh/r/form-10.json
- https://ui.watermelon.sh/components/select
- https://registry.watermelon.sh/r/select-21.json
- https://github.com/WatermelonCorp/watermelon-platform

视图切换参考 [Breadcrumb 6](https://ui.watermelon.sh/components/breadcrumb) 与官方 `breadcrumb-6` 注册表源码，使用现有 Vue 弹出菜单组件适配。

- `ScheduleNotifications.vue`: Notification 1's single-column feed, circular category icons,
  unread dots, row dividers, muted descriptions and mark-all-read footer. Uses the existing
  shared tabs, select, drawer and pagination; business navigation and approval rules remain local.
  Drawer/row transitions are local additions with reduced-motion support.
  https://ui.watermelon.sh/block/notification-1
  https://registry.watermelon.sh/r/notification-1.json

## Factory dashboard references

Factory analysis adapts the following dashboard compositions to Vue and the existing ECharts
renderer. These are visual adaptations, not installed React dashboards; all series use the
local reporting APIs, and upstream sample data is not included.

- Capitalio: metric sparklines, segmented allocation rail with striped fills, value/share
  legends. Shared `DashboardMetric` and `DashboardDistribution` retain local units, signed
  corrections, and business drill-down actions.
  https://ui.watermelon.sh/dashboard/capitalio-dashboard
- Medesk: grouped bars, rounded ends, sparse dashed grid and compact legends for production
  comparisons. Quality percentages keep their material/inspection basis rather than being averaged.
  The running overview also adapts its wide primary workspace / narrow action-list composition;
  `FactoryTeamStatus` uses the shared table and buttons for actual stock states and filtered links.
  https://ui.watermelon.sh/dashboard/medesk-dashboard
- Library: paired time series with light area fills and a clean delivery donut. Shared
  `useDashboardChart` supplies light/dark tooltips and chart primitives; `LedgerChart` provides
  800ms entrance / 400ms data updates with reduced-motion support.
  https://ui.watermelon.sh/dashboard/library-dashboard

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
