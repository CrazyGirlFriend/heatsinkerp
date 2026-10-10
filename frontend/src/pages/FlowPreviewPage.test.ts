// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import { appPinia } from '@/stores/access'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import FlowPreviewCanvas from '@/components/FlowPreviewCanvas.vue'
import MaterialTransferDrawer from '@/components/MaterialTransferDrawer.vue'
import TraceStockSummary from '@/components/TraceStockSummary.vue'
import TableExportButton from '@/components/TableExportButton.vue'
import FilterDialog from '@/components/FilterDialog.vue'
import RecordDateFilter from '@/components/RecordDateFilter.vue'
import FlowPreviewPage from './FlowPreviewPage.vue'
import snapshot from '@/fixtures/flowPurposeSnapshot.json'
import type { SerialHistory } from '@/types/teamBusiness'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { ElPopover, ElSelect, ElTooltip } from 'element-plus'

const live = vi.hoisted(() => ({ refresh: async () => {} }))
vi.mock('@/composables/useLiveRefresh', async () => {
  const { ref } = await import('vue')
  return { useLiveRefresh: (refresh: () => Promise<void>) => { live.refresh = refresh; return { message: ref(''), request: vi.fn() } } }
})
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks() })
async function render(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/flow-preview/:view', component: FlowPreviewPage }, { path: '/team-workspaces/:teamId', component: { template: '<div />' } }, { path: '/material-trace', component: { template: '<div />' } }, { path: '/transfer-batches', component: { template: '<div />' } }] })
  await router.push(path)
  wrapper = mount(FlowPreviewPage, { attachTo: document.body, global: { plugins: [appPinia, router], stubs: { FlowPreviewCanvas: true, MaterialTransferDrawer: true } } })
  await flushPromises()
  return { page: wrapper, router }
}
it('shows A/B reallocation records and can follow the related serial without calling it a warehouse intake', async () => {
  const target = normalizeMaterialTransfer({ id: 201, batch_no: 'ALLOC-B', entry_kind: 'serial_reallocation', serial_no: '000B', source_serial_no: '000A', source_transfer_id: 101, source_transfer_batch_no: 'INTAKE-A', source_team: { id: 8, code: 'FACTORY-QC', name: '检验' }, next_team: { id: 8, code: 'FACTORY-QC', name: '检验' }, quantity: 30, weight: 3, status: 'received', received_at: '2026-09-20T00:00:00Z', created_at: '2026-09-20T00:00:00Z', stock_tracked: true })
  vi.spyOn(materialTransferApi, 'trace').mockResolvedValue({ ...snapshot.trace, serial_no: '000B', observed_at: '2026-09-21T00:00:00Z', items: [{ ...target, on_hand_quantity: 30, on_hand_weight: 3 }], reallocations: [target] })
  const { page, router } = await render('/material-trace?serial_no=000B')
  expect(page.text()).toContain('000A 转投入')
  expect(page.get('.origin-input').text()).toContain('3')
  expect(page.get('.origin-input').text()).toContain('流入物料')
  await page.findAll('button').find(button => button.text() === '转投记录 1')!.trigger('click'); await flushPromises()
  const dialog = document.body.querySelector('.el-dialog')!
  expect(dialog.textContent).toContain('INTAKE-A')
  expect(dialog.textContent).toContain('ALLOC-B')
  const serialButton = [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === '000A')!
  serialButton.click(); await flushPromises()
  expect(router.currentRoute.value.query.serial_no).toBe('000A')
  expect(materialTransferApi.trace).toHaveBeenLastCalledWith('000A')
})
it('filters a complete intake family and keeps its source distinct from the previous batch', async () => {
  const items = snapshot.trace.items.map(item => ({ ...normalizeMaterialTransfer(item), on_hand_quantity: item.on_hand_quantity, on_hand_weight: item.on_hand_weight }))
  const seed = items[0]!
  const first = { ...seed, id: 101, batch_no: 'WAREHOUSE-A', entry_kind: 'warehouse_receipt' as const, source_transfer_id: null, on_hand_quantity: 40, on_hand_weight: 40, owned_quantity: 40, owned_weight: 40 }
  const other = { ...first, id: 102, batch_no: 'WAREHOUSE-B', on_hand_quantity: 999, on_hand_weight: 999, owned_quantity: 999, owned_weight: 999 }
  const previous = { ...seed, id: 103, batch_no: 'PREVIOUS-A', source_transfer_id: 101, source_transfer_batch_no: 'WAREHOUSE-A', on_hand_quantity: 20, on_hand_weight: 20, owned_quantity: 60, owned_weight: 60 }
  const pending = { ...seed, id: 104, batch_no: 'PENDING-A', source_transfer_id: 103, source_transfer_batch_no: 'PREVIOUS-A', status: 'pending' as const, quantity: 40, weight: 40, on_hand_quantity: null, on_hand_weight: null }
  vi.spyOn(materialTransferApi, 'trace').mockResolvedValue({ ...snapshot.trace, items: [first, other, previous, pending] })
  const { page } = await render('/material-trace?serial_no=000012')
  page.getComponent(FlowPreviewCanvas).vm.zoom = vi.fn()
  const filter = page.findAllComponents(ElSelect).find(select => select.props('ariaLabel') === '筛选来源入库批次')!
  filter.vm.$emit('change', '101'); await flushPromises()
  expect(page.getComponent(TraceStockSummary).props('trace').items.map(item => item.id)).toEqual([101, 103, 104])
  await page.get('input[aria-label="流水号"]').setValue('UNSENT')
  const source = page.getComponent(TableExportButton).props('source')()!
  const exported = await source.load(new AbortController().signal, () => undefined)
  expect(exported.map(row => row.batch_no)).toEqual(['WAREHOUSE-A', 'PREVIOUS-A', 'PENDING-A'])
  expect(source.title).not.toContain('UNSENT')
  page.getComponent(FlowPreviewCanvas).vm.$emit('select', { dataIndex: 0, data: { batchId: '104' } }); await flushPromises()
  const detail = page.get('[aria-label="选中批次收发详情"]').text()
  expect(detail).toContain('来源批次WAREHOUSE-A')
  expect(detail).toContain('上一批次PREVIOUS-A')
  expect(detail).toContain('已占用可转额度')
  filter.vm.$emit('change', '102'); await flushPromises()
  expect(page.getComponent(TraceStockSummary).props('trace').items).toHaveLength(1)
  expect(page.find('.selection-chip').exists()).toBe(false)
})
it('labels the snapshot and does not query live stock or open a possibly unrelated real batch', async () => {
  const team = vi.spyOn(teamMaterialApi, 'serialHistory'), trace = vi.spyOn(materialTransferApi, 'trace')
  const { page } = await render('/flow-preview/team?sample=purposes')
  expect(page.text()).toContain('演示数据 · 非实时')
  expect(page.text()).toContain('153')
  expect(page.get('input[aria-label="流水号"]').attributes('disabled')).toBeDefined()
  expect(team).not.toHaveBeenCalled(); expect(trace).not.toHaveBeenCalled()
  page.getComponent(FlowPreviewCanvas).vm.$emit('select', { dataIndex: 0, data: { title: '检验', description: '接收业务', quantity: 100, weight: 12.5, batches: [snapshot.history.flows[0]!.batch_no] } })
  await flushPromises()
  expect(document.body.textContent).toContain('演示数据，不打开业务单据')
  expect(document.body.querySelector('.selection-batches button')?.hasAttribute('disabled')).toBe(true)
})
it('queries exact serials and keeps the canvas and unsent input intact on push refresh', async () => {
  vi.spyOn(teamMaterialApi, 'serialHistory').mockResolvedValue(snapshot.history as SerialHistory)
  const { page } = await render('/flow-preview/team?serial_no=000012&team_id=8')
  expect(teamMaterialApi.serialHistory).toHaveBeenCalledWith(8, { serial_no: '000012' })
  const canvas = page.getComponent(FlowPreviewCanvas).element
  await page.get('input[aria-label="流水号"]').setValue('UNSENT')
  await live.refresh(); await flushPromises()
  expect(page.getComponent(FlowPreviewCanvas).element).toBe(canvas)
  expect(page.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'UNSENT')
})
it('applies date filters in the standalone team view and refreshes only the applied range', async () => {
  vi.spyOn(teamMaterialApi, 'serialHistory').mockResolvedValue(snapshot.history as SerialHistory)
  const { page, router } = await render('/flow-preview/team?serial_no=000012&team_id=8')
  await page.getComponent(FilterDialog).get('button').trigger('click'); await flushPromises()
  page.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-18', to: '2026-09-20' })
  page.getComponent(FilterDialog).vm.$emit('apply'); await flushPromises()
  expect(router.currentRoute.value.query.date_from).toBe('2026-09-18')
  expect(teamMaterialApi.serialHistory).toHaveBeenLastCalledWith(8, { serial_no: '000012', date_from: '2026-09-18', date_to: '2026-09-20' })
  await page.getComponent(FilterDialog).get('button').trigger('click'); await flushPromises()
  page.getComponent(RecordDateFilter).vm.$emit('update:modelValue', { from: '2026-09-22', to: '2026-09-22' })
  await live.refresh(); await flushPromises()
  expect(teamMaterialApi.serialHistory).toHaveBeenLastCalledWith(8, { serial_no: '000012', date_from: '2026-09-18', date_to: '2026-09-20' })
})
it('separates the administrator chain entry from the team page', async () => {
  const { page } = await render('/flow-preview/chain?sample=purposes')
  expect(page.find('nav[aria-label="流向视图"]').exists()).toBe(false)
  expect(page.get('h1').text()).toBe('全链路追踪')
  expect(page.text()).toContain('7 批次')
  expect(page.text()).toContain('演示数据 · 非实时')
  expect(page.findAllComponents(FlowPreviewCanvas)).toHaveLength(1)
})
it('shows a single SVG time canvas with both units and hover details instead of opening a drawer', async () => {
  const { page } = await render('/flow-preview/chain?sample=purposes')
  const canvas = page.getComponent(FlowPreviewCanvas)
  expect(canvas.props('renderer')).toBe('svg')
  expect(page.find('.metric-strip').exists()).toBe(false)
  expect(page.find('.chart-caption').exists()).toBe(false)
  expect(canvas.props('label')).toContain('滚轮缩放，H键平移，V键选择')
  // The snapshot is immutable: a 47 ms handoff must not be stretched into an invented day.
  canvas.vm.$emit('select', { dataIndex: 1, data: {} })
  await flushPromises()
  expect(page.find('.selection-chip').exists()).toBe(true)
  expect(document.body.querySelector('.flow-selection-drawer')).toBeNull()
  expect(page.findComponent(MaterialTransferDrawer).exists()).toBe(false)
  const tooltip = canvas.props('option').tooltip as { triggerOn: string; formatter: (params: { dataIndex: number }) => string }
  expect(tooltip.triggerOn).toBe('mousemove')
  expect(page.get('[aria-label="选中批次收发详情"]').text()).toContain('上一批次')
  expect(tooltip.formatter({ dataIndex: 1 })).toContain('点击查看详情')
  expect(tooltip.formatter({ dataIndex: 1 })).toContain('kg')
  expect(page.getComponent(FlowPreviewCanvas).props('option')).toHaveProperty('dataZoom')
})
it('does not replace a zoomed canvas or overwrite draft input when chain data is refreshed', async () => {
  vi.spyOn(materialTransferApi, 'trace').mockResolvedValue({ ...snapshot.trace, items: snapshot.trace.items.map(item => ({ ...normalizeMaterialTransfer(item), on_hand_quantity: item.on_hand_quantity, on_hand_weight: item.on_hand_weight })) })
  const { page } = await render('/flow-preview/chain?serial_no=000012')
  const canvas = page.getComponent(FlowPreviewCanvas).element
  await page.get('input[aria-label="流水号"]').setValue('draft')
  await live.refresh(); await flushPromises()
  expect(page.getComponent(FlowPreviewCanvas).element).toBe(canvas)
  expect(page.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'draft')
  expect(materialTransferApi.trace).toHaveBeenLastCalledWith('000012')
})
it('groups chain controls in one floating toolbar with independent selection, pan, replay and motion states', async () => {
  const { page } = await render('/flow-preview/chain?sample=purposes')
  const canvas = page.getComponent(FlowPreviewCanvas)
  expect(page.findAll('[aria-label="画布工具"]')).toHaveLength(1)
  expect(page.findComponent(ElSelect).props('appendTo')).toBe(page.element)
  expect(page.findAllComponents(ElTooltip).filter(tooltip => tooltip.props('content')).every(tooltip => tooltip.props('appendTo') === page.element)).toBe(true)
  expect(page.find('.chart-toolbar [aria-label="全屏画布"]').exists()).toBe(false)
  expect(canvas.props('interaction')).toBe('select')
  await page.get('[aria-label="平移画布"]').trigger('click')
  expect(canvas.props('interaction')).toBe('pan')
  expect(page.get('[aria-label="平移画布"]').attributes('aria-pressed')).toBe('true')
  await page.trigger('keydown', { key: 'v' })
  expect(canvas.props('interaction')).toBe('select')
  await page.get('input[aria-label="流水号"]').trigger('keydown', { key: 'h' })
  expect(canvas.props('interaction')).toBe('select')
  await page.get('[aria-label="重播路径"]').trigger('click')
  expect(canvas.props('replay')).toBe(1)
  await page.get('[aria-label="关闭图形动画"]').trigger('click')
  expect(canvas.props('motion')).toBe(false)
  expect(page.get('[aria-label="重播路径"]').attributes('disabled')).toBeDefined()
  expect(canvas.props('replay')).toBe(1)
})
it('selects the correct batch from a residence interval and clears its highlight without replaying', async () => {
  const { page } = await render('/flow-preview/chain?sample=purposes')
  const canvas = page.getComponent(FlowPreviewCanvas)
  const batch = snapshot.trace.items.at(-1)!
  canvas.vm.$emit('select', { dataIndex: 0, data: { batchId: String(batch.id) } })
  await flushPromises()
  expect(page.find('.selection-chip').exists()).toBe(true)
  expect(page.get('.selection-chip').text()).toContain(batch.batch_no)
  await page.get('[aria-label="取消路径高亮"]').trigger('click')
  expect(page.find('.selection-chip').exists()).toBe(false)
  expect(canvas.props('replay')).toBe(0)
})
it('uses one compact business query header without repeated headings, demo actions or permanent instructions', async () => {
  vi.spyOn(materialTransferApi, 'trace').mockResolvedValue({ ...snapshot.trace, items: snapshot.trace.items.map(item => ({ ...normalizeMaterialTransfer(item), on_hand_quantity: item.on_hand_quantity, on_hand_weight: item.on_hand_weight })) })
  const { page } = await render('/material-trace?serial_no=000012')
  expect(page.findAll('h1')).toHaveLength(1)
  expect(page.get('.chain-header input[aria-label="流水号"]').element).toHaveProperty('value', '000012')
  expect(page.find('.preview-heading, .preview-topbar, .chain-guide, .chart-caption, .data-note, .sample-toggle').exists()).toBe(false)
  expect(page.classes()).toContain('chain-page--embedded')
  expect(page.get('h1').classes()).toContain('sr-only')
  expect(page.find('a[aria-label="返回转料记录"]').exists()).toBe(false)
  expect(page.get('.chain-fullscreen').text()).toBe('全屏查看')
  await page.get('[aria-label="刷新数据"]').trigger('click')
  await flushPromises()
  expect(materialTransferApi.trace).toHaveBeenCalledTimes(2)
  expect(materialTransferApi.trace).toHaveBeenLastCalledWith('000012')
  page.getComponent(FlowPreviewCanvas).vm.$emit('select', { dataIndex: 1, data: {} })
  await flushPromises()
  expect(page.get('.selection-chip').text()).toContain('TL')
  expect(page.findComponent(MaterialTransferDrawer).exists()).toBe(false)
  expect(document.body.querySelector('.flow-selection-drawer')).toBeNull()
})
it('retains visible data-quality counts and puts their explanations and timestamps behind the help button', async () => {
  const items = snapshot.trace.items.map(item => ({ ...normalizeMaterialTransfer(item), on_hand_quantity: item.on_hand_quantity, on_hand_weight: item.on_hand_weight }))
  items[1] = { ...items[1]!, status: 'received', received_at: null }
  vi.spyOn(materialTransferApi, 'trace').mockResolvedValue({ ...snapshot.trace, items, untracked_count: 2 })
  const { page } = await render('/material-trace?serial_no=000012')
  expect(page.text()).toContain('时间异常 1')
  expect(page.text()).toContain('未计入库存 2')
  const help = page.getComponent(ElPopover)
  expect(help.props('appendTo')).toBe(page.element)
  expect(help.props('trigger')).toBe('click')
  await page.get('[aria-label="画布说明"]').trigger('click')
  await flushPromises()
  expect(document.body.textContent).toContain('2 个历史批次未计入库存。')
  expect(document.body.textContent).toContain('1 个批次时间异常，仅显示有效时间点。')
  expect(document.body.textContent).toContain('北京时间')
})
it('keeps empty and not-found states short without removing serial validation', async () => {
  vi.spyOn(materialTransferApi, 'trace').mockResolvedValue({ ...snapshot.trace, items: [] })
  const { page } = await render('/material-trace')
  expect(page.get('.preview-empty').text()).toBe('输入流水号查询')
  await page.get('.chain-query').trigger('submit')
  expect(page.text()).toContain('请输入完整流水号')
  await page.get('input[aria-label="流水号"]').setValue('000000')
  await page.get('.chain-query').trigger('submit')
  await flushPromises()
  expect(materialTransferApi.trace).toHaveBeenLastCalledWith('000000')
  expect(page.get('.preview-empty').text()).toBe('暂无记录')
})
it('opens only the embedded canvas fullscreen without navigating or resetting the query', async () => {
  vi.spyOn(materialTransferApi, 'trace').mockResolvedValue({ ...snapshot.trace, items: [] })
  const { page, router } = await render('/material-trace?serial_no=000012')
  const requestFullscreen = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(page.element, 'requestFullscreen', { value: requestFullscreen })
  await page.get('.chain-fullscreen').trigger('click')
  await flushPromises()
  expect(requestFullscreen).toHaveBeenCalledOnce()
  expect(router.currentRoute.value.fullPath).toBe('/material-trace?serial_no=000012')
  expect(page.get('input[aria-label="流水号"]').element).toHaveProperty('value', '000012')
  expect(materialTransferApi.trace).toHaveBeenCalledOnce()
})
