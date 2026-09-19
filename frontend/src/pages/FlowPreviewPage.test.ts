// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'
import { appPinia } from '@/stores/access'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import { materialTransferApi } from '@/services/materialTransferApi'
import FlowPreviewCanvas from '@/components/FlowPreviewCanvas.vue'
import FlowPreviewPage from './FlowPreviewPage.vue'
import snapshot from '@/fixtures/flowPurposeSnapshot.json'
import type { SerialHistory } from '@/types/teamBusiness'
import { normalizeMaterialTransfer } from '@/services/materialTransferApi'
import { ElSelect, ElTooltip } from 'element-plus'

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
it('labels the snapshot and does not query live stock or open a possibly unrelated real batch', async () => {
  const team = vi.spyOn(teamMaterialApi, 'serialHistory'), trace = vi.spyOn(materialTransferApi, 'trace')
  const { page } = await render('/flow-preview/team?sample=purposes')
  expect(page.text()).toContain('演示快照 · 非实时')
  expect(page.text()).toContain('153')
  expect(page.get('input[aria-label="流水号"]').attributes('disabled')).toBeDefined()
  expect(team).not.toHaveBeenCalled(); expect(trace).not.toHaveBeenCalled()
  page.getComponent(FlowPreviewCanvas).vm.$emit('select', { dataIndex: 0, data: { title: '检验', description: '接收用途', quantity: 100, weight: 12.5, batches: [snapshot.history.flows[0]!.batch_no] } })
  await flushPromises()
  expect(document.body.textContent).toContain('演示快照，不打开业务单据')
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
it('separates the administrator chain entry from the team page', async () => {
  const { page } = await render('/flow-preview/chain?sample=purposes')
  expect(page.find('nav[aria-label="流向视图"]').exists()).toBe(false)
  expect(page.text()).toContain('全链路追踪 · 管理员')
  expect(page.text()).toContain('7 个独立批次')
  expect(page.findAllComponents(FlowPreviewCanvas)).toHaveLength(1)
})
it('shows a single SVG time canvas with both units, accurate event times and optional detail', async () => {
  const { page } = await render('/flow-preview/chain?sample=purposes')
  const canvas = page.getComponent(FlowPreviewCanvas)
  expect(canvas.props('renderer')).toBe('svg')
  expect(page.find('.metric-strip').exists()).toBe(false)
  expect(page.text()).toContain('点击查看 · H 切换平移 · 滚轮缩放')
  // The snapshot is immutable: a 47 ms handoff must not be stretched into an invented day.
  canvas.vm.$emit('select', { dataIndex: 1, data: {} })
  await flushPromises()
  expect(document.body.textContent).toContain('转出时间')
  expect(document.body.textContent).toContain('接收时间')
  expect(document.body.textContent).toContain('2026-09-18 16:44:09.')
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
it('keeps selection discoverable after closing details and allows clearing it without replaying', async () => {
  const { page } = await render('/flow-preview/chain?sample=purposes')
  const canvas = page.getComponent(FlowPreviewCanvas)
  canvas.vm.$emit('select', { dataIndex: 1, data: {} })
  await flushPromises()
  expect(page.find('.selection-chip').exists()).toBe(true)
  await page.get('[aria-label="取消路径高亮"]').trigger('click')
  expect(page.find('.selection-chip').exists()).toBe(false)
  expect(canvas.props('replay')).toBe(0)
})
