// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import AppDialog from './AppDialog.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import { processRouteApi, ProcessRouteSerialConflictError } from '@/services/processRouteApi'
import { routeFixture as baseRouteFixture, reworkRouteFixture } from '@/testFixtures/processRoute'
import { defineComponent, h } from 'vue'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import type { ProcessRoute } from '@/types/processRoute'
const routeFixture: ProcessRoute = {
  ...baseRouteFixture,
  drawings: [{ id: 70, filename: '完整图纸.pdf', size_bytes: 100 }],
  source_data: {
    ...baseRouteFixture.source_data,
    order_document: { ...orderFixture, serial_no: 'S-001' },
  },
}
const openWord = vi.fn(),
  openDrawing = vi.fn()
const originalStub = (name: string, open: typeof openWord) =>
  defineComponent({
    name,
    props: [
      'route',
      'sourceFile',
      'routeId',
      'drawing',
      'file',
      'sourceRow',
      'compact',
      'thumbnail',
    ],
    setup(_props, { expose }) {
      expose({ open, ready: true })
      return () =>
        h('button', {
          'aria-label': name === 'WordDocumentPreview' ? '放大工艺原稿' : '放大图纸',
          onClick: open,
        })
    },
  })
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 1, code: 'FACTORY-WAREHOUSE', name: '库房', active: true, kind: 'warehouse' },
      { id: 2, code: 'FACTORY-GRIND', name: '研磨', active: true, kind: 'production' },
    ],
    refreshTeamDirectory: async () => {},
  }),
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isAdmin: true, currentUser: { active: true }, currentUserError: '' }),
}))
let wrapper: VueWrapper
beforeEach(() => {
  openWord.mockReset()
  openDrawing.mockReset()
  vi.spyOn(processRouteApi, 'options').mockImplementation(async (teamId) => ({
    tasks: teamId === 1 ? [] : [{ id: 4, team_id: teamId, name: '精磨', active: true, version: 1 }],
    purposes: [{ id: 3, team_id: teamId, name: '产品加工', active: true, version: 1 }],
  }))
  vi.spyOn(processRouteApi, 'save').mockImplementation(async (route) =>
    JSON.parse(JSON.stringify({ ...route, version: 2 })),
  )
  vi.spyOn(processRouteApi, 'publish').mockImplementation(async (route) => ({
    ...JSON.parse(JSON.stringify(route)),
    state: 'published',
  }))
  vi.spyOn(processRouteApi, 'revise').mockResolvedValue({
    ...structuredClone(routeFixture),
    id: 9,
    parent_id: routeFixture.id,
    state: 'draft',
  })
})
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
async function render(
  published = false,
  route = routeFixture,
  viewOnly = false,
  startEditing = false,
) {
  wrapper = mount(ProcessRouteEditor, {
    props: {
      viewOnly,
      startEditing,
      route: structuredClone({
        ...route,
        state: published ? ('published' as const) : ('draft' as const),
      }),
    },
    global: {
      directives: { loading: () => {} },
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div><slot/><slot name="footer"/></div>',
        },
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        WordDocumentPreview: originalStub('WordDocumentPreview', openWord),
        ProcessRouteDrawingPreview: originalStub('ProcessRouteDrawingPreview', openDrawing),
        DocumentViewer: true,
      },
    },
  })
  await flushPromises()
  if (!published && !viewOnly && !startEditing) await click('修改工艺')
}
async function click(text: string) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === text)!
    .trigger('click')
  await flushPromises()
}
it('preserves original text and saves the version before publication', async () => {
  await render()
  expect(wrapper.text()).not.toContain('导入提醒')
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledOnce()
  expect(processRouteApi.publish).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }))
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps[1]!.instructions).toContain(
    '2.5(+0.01/-0.02)',
  )
  const dialog = wrapper.getComponent(AppDialog)
  expect(dialog.props('modelValue')).toBe(false)
  expect(wrapper.emitted('saved')).toHaveLength(1)
  expect(wrapper.emitted('close')).toBeUndefined()
  dialog.vm.$emit('closed')
  expect(wrapper.emitted('close')).toEqual([[]])
})

it.each([false, true])(
  'closes the editor only after all save requests succeed (published: %s)',
  async (published) => {
    let finishPublication!: (route: ProcessRoute) => void
    vi.mocked(processRouteApi.publish).mockImplementationOnce(
      () => new Promise((resolve) => (finishPublication = resolve)),
    )
    await render(published, routeFixture, false, published)
    await click('保存工艺')
    expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(true)
    expect(wrapper.emitted('saved')).toBeUndefined()

    finishPublication({ ...routeFixture, state: 'published' })
    await flushPromises()
    expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(false)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('修改工艺')
  },
)

it('keeps the entered form open after publication fails and closes it after a successful retry', async () => {
  vi.mocked(processRouteApi.publish).mockRejectedValueOnce(new Error('工艺保存失败'))
  await render()
  const instructions = wrapper.get('textarea[aria-label="工序 2 工艺要求"]')
  await instructions.setValue('精磨后测量厚度')
  await click('保存工艺')
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(true)
  expect(wrapper.emitted('saved')).toBeUndefined()
  expect(wrapper.text()).toContain('工艺保存失败')
  expect((instructions.element as HTMLTextAreaElement).value).toBe('精磨后测量厚度')

  await click('保存工艺')
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(false)
  expect(wrapper.emitted('saved')).toHaveLength(1)
})

it('publishes engineering with its original and drawings without asking for an order', async () => {
  const route = structuredClone(routeFixture)
  delete route.source_data.order_document
  await render(false, route)
  expect(wrapper.text()).not.toContain('导入订单表')
  expect(wrapper.find('[aria-label="导入订单表文件"]').exists()).toBe(false)
  expect(wrapper.get('[aria-label="工艺附件缩略图"]').text()).not.toContain('订单表')
  await click('保存工艺')
  expect(processRouteApi.publish).toHaveBeenCalledOnce()
})

it('saves engineering with an independent serial without rewriting its retained order', async () => {
  const route = structuredClone(routeFixture)
  route.serial_nos = ['PROCESS-001']
  route.source_data.word_fields = {
    serial_no: {
      ...orderFixture.receipt_fields.serial_no!,
      value: 'PROCESS-001',
      source_kind: 'word',
    },
  }
  route.source_data.receipt_fields = structuredClone(route.source_data.word_fields)
  await render(false, route)
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledWith(
    expect.objectContaining({
      serial_nos: ['PROCESS-001'],
      source_data: expect.objectContaining({
        word_fields: expect.objectContaining({
          serial_no: expect.objectContaining({ value: 'PROCESS-001' }),
        }),
        order_document: expect.objectContaining({ serial_no: 'S-001' }),
      }),
    }),
  )
  expect(processRouteApi.publish).toHaveBeenCalledOnce()
  expect(wrapper.text()).not.toContain('流水号与订单表不一致')
})

it('marks a duplicate serial and keeps the entered form until that serial is corrected', async () => {
  await render()
  const message = '流水号“S-001”已有正常工艺，请打开原工艺修改'
  vi.mocked(processRouteApi.save).mockRejectedValueOnce(
    new ProcessRouteSerialConflictError(message),
  )
  await click('保存工艺')
  expect(
    wrapper.findAll('.el-form-item.is-error').some((item) => item.text().includes(message)),
  ).toBe(true)
  expect((wrapper.get('input[aria-label="流水号"]').element as HTMLInputElement).value).toBe(
    routeFixture.serial_nos[0],
  )
  expect(processRouteApi.publish).not.toHaveBeenCalled()
  await wrapper.get('input[aria-label="流水号"]').setValue('S-002')
  await flushPromises()
  expect(
    wrapper.findAll('.el-form-item.is-error').some((item) => item.text().includes(message)),
  ).toBe(false)
})

it('shows the authored rework scope and instructions in the same form without modification controls', async () => {
  await render(true, reworkRouteFixture, true)
  const text = wrapper.text()
  for (const value of [
    '张工',
    'TL-REWORK-1',
    '4 件',
    '40 kg',
    '原加工记录',
    '#42',
    '尺寸偏差，重新精磨',
    '返工精磨至2.50±0.01mm',
    '接回正常工序',
  ])
    expect(text).toContain(value)
  expect(
    wrapper.findAll('button').some((button) => /修改返工工艺|保存工艺/.test(button.text())),
  ).toBe(false)
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('carries quality problems and teams into manual rework engineering with inherited drawings', async () => {
  const drawing = { id: 91, filename: 'S-001图纸.pdf', size_bytes: 100 }
  await render(
    false,
    {
      ...reworkRouteFixture,
      steps: [],
      drawings: [drawing],
      rework_request: {
        ...reworkRouteFixture.rework_request!,
        inspection_id: 19,
        inspection_kind: 'patrol',
        problem_names: ['尺寸超差'],
        problem_notes: '厚度实测2.60mm',
        problem_teams: [
          { id: 2, name: '研磨' },
          { id: 3, name: '轧制' },
        ],
      },
    },
    false,
    true,
  )
  for (const value of ['返工问题', '尺寸超差', '厚度实测2.60mm', '巡检 #19'])
    expect(wrapper.get('.route-rework-context').text()).toContain(value)
  expect(
    wrapper.findAll('[aria-label="涉及班组"] [role="listitem"]').map((cell) => cell.text()),
  ).toEqual(['研磨', '轧制'])
  expect(wrapper.text()).not.toContain('导入工艺单')
  expect(wrapper.text()).not.toContain('工艺原稿')
  expect(wrapper.find('input[accept=".docx"]').exists()).toBe(false)
  expect(wrapper.find('input[aria-label="上传图纸文件"]').exists()).toBe(true)
  expect(wrapper.getComponent(ProcessRouteDrawingPreview).props()).toMatchObject({
    routeId: reworkRouteFixture.id,
    drawing,
  })
  expect(wrapper.get('input[aria-label="流水号"]').attributes('disabled')).toBeDefined()
  expect(wrapper.find('.route-execution-toggle').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('具体任务')
  expect(wrapper.text()).not.toContain('参考天数')
  expect(wrapper.text()).not.toContain('适用流水号')
  expect(wrapper.text()).not.toContain('手工录入')
  expect(wrapper.text()).toContain('补充图纸')
  await wrapper.get('button[aria-label="放大图纸"]').trigger('click')
  expect(openDrawing).toHaveBeenCalledOnce()
  expect(openWord).not.toHaveBeenCalled()
})
it('keeps published steps immutable and offers source/revision actions', async () => {
  await render(true)
  expect(wrapper.text()).not.toContain('删除工序')
  expect(wrapper.text()).not.toContain('保存工艺')
  expect(wrapper.text()).toContain('工艺原稿')
  expect(wrapper.find('[aria-label="放大订单表"]').exists()).toBe(false)
})
it('retains an editable draft when publication is rejected', async () => {
  vi.mocked(processRouteApi.publish).mockRejectedValue(new Error('工序序号必须递增且不能重复'))
  await render()
  await click('保存工艺')
  expect(wrapper.text()).toContain('不能重复')
  expect(wrapper.text()).toContain('保存工艺')
})

it('marks missing publication fields in red before sending a request', async () => {
  await render()
  await wrapper.setProps({ route: routeFixture })
  const firstName = wrapper
    .findAll('input')
    .find((input) => input.attributes('aria-label') === '流水号')!
  await firstName.setValue('')
  await click('保存工艺')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(wrapper.find('.el-form-item.is-error').exists()).toBe(true)
})

it('previews the original file while edits leave its retained source unchanged', async () => {
  await render()
  const original = wrapper.getComponent(WordDocumentPreview)
  expect(original.props('route').id).toBe(routeFixture.id)
  expect(original.props('route').filename).toBe('工艺.docx')
  expect(wrapper.find('.route-original-row').exists()).toBe(false)
  const field = wrapper.findAll('textarea').find((item) => item.element.value.includes('2.5'))!
  await field.setValue('核对后修改的工艺要求')
  expect(original.props('route').steps[1]!.instructions).toBe('核对后修改的工艺要求')
  expect(original.props('route').source_data.original_steps![1]!.instructions).toBe(
    '厚度2.5(+0.01/-0.02)，禁止摞放',
  )
  expect(original.props('route').source_data.tables).toEqual(routeFixture.source_data.tables)
})

it('maps the original transit store to warehouse for an older imported draft', async () => {
  const route = structuredClone(routeFixture)
  route.steps[0]!.name = '中转库'
  route.steps[0]!.team_id = null
  route.source_data.original_steps![0]!.name = '中转库'
  await render(false, route)
  expect(wrapper.text()).not.toContain('原文“中转库”')
  await click('保存工艺')
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps[0]!.team_id).toBe(1)
})

it('shows the source row for the focused step without replacing the actual original file', async () => {
  await render()
  await wrapper.findAll('.route-edit-step')[1]!.trigger('focusin')
  expect(wrapper.getComponent(WordDocumentPreview).props('sourceRow')).toBe('1:2')
  expect(wrapper.getComponent(WordDocumentPreview).props('route').id).toBe(routeFixture.id)
  expect(wrapper.find('.route-original-row--active').exists()).toBe(false)
})

it('keeps a warehouse route preview read-only without save, publication or revision actions', async () => {
  await render(true, routeFixture, true)
  expect(wrapper.text()).not.toContain('保存工艺')
  expect(wrapper.text()).not.toContain('保存工艺')
  expect(wrapper.text()).not.toContain('修改工艺')
  expect(wrapper.text()).toContain('工艺原稿')
  expect(processRouteApi.options).not.toHaveBeenCalled()
})

it('saves without execution presets or loading team task settings', async () => {
  const route = structuredClone(routeFixture)
  route.steps.forEach((step) => {
    step.processing_task_id = null
    step.purpose_id = null
  })
  await render(false, route)
  expect(processRouteApi.options).not.toHaveBeenCalled()
  for (const label of ['执行设置', '具体任务', '对应业务', '参考天数', '适用流水号'])
    expect(wrapper.text()).not.toContain(label)
  await click('保存工艺')
  expect(processRouteApi.publish).toHaveBeenCalledOnce()
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps).toEqual(route.steps)
})

it('keeps step deletion available without execution settings', async () => {
  await render(false, routeFixture)
  await wrapper.get('button[aria-label="删除工序 2"]').trigger('click')
  await click('保存工艺')
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps.map((step) => step.name)).toEqual([
    '备料',
    '精磨',
    '终检',
  ])
})

it('names a new rework step from its assigned team without a hidden name field', async () => {
  await render(false, { ...reworkRouteFixture, steps: [] }, false, true)
  await wrapper.get('textarea[aria-label="工序 1 工艺要求"]').setValue('返工精磨至图纸要求')
  await click('提交工艺')
  expect(processRouteApi.publish).toHaveBeenCalledOnce()
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps[0]).toMatchObject({
    name: '研磨',
    team_id: 2,
    processing_task_id: null,
    purpose_id: null,
  })
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(false)
  expect(wrapper.emitted('saved')).toHaveLength(1)
})

async function renderNew() {
  wrapper = mount(ProcessRouteEditor, {
    global: {
      directives: { loading: () => {} },
      stubs: {
        AppDialog: {
          props: ['modelValue'],
          template: '<div><slot/><slot name="footer"/></div>',
        },
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        WordDocumentPreview: true,
        ProcessRouteDrawingPreview: true,
      },
    },
  })
  await flushPromises()
}
async function files(label: string, values: File[]) {
  const input = wrapper.get(`input[aria-label="${label}"]`)
  Object.defineProperty(input.element, 'files', { configurable: true, value: values })
  await input.trigger('change')
  await flushPromises()
}
it('opens a manual form without importing or persisting a blank record', async () => {
  const parse = vi.spyOn(processRouteApi, 'parse')
  await renderNew()
  expect(wrapper.findAll('thead th').map((item) => item.text())).toEqual([
    '序号',
    '执行班组',
    '工艺要求',
    '计划加工数量',
    '操作',
  ])
  expect(wrapper.get('[aria-label="工艺附件缩略图"]').text()).toContain('工艺原件未上传')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(parse).not.toHaveBeenCalled()
  await wrapper.get('input[aria-label="流水号"]').setValue('NEW-001')
  await wrapper.get('textarea[aria-label="工序 1 工艺要求"]').setValue('按来料备料')
  await click('保存工艺')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('缺少：工艺原件、图纸')
})
it('creates a new route with its original and drawings in one request', async () => {
  const file = new File(['word'], '导入工艺.docx')
  const drawing = new File(['pdf'], '加工图纸.pdf')
  vi.mocked(processRouteApi.publish).mockImplementation(async (route) => {
    await flushPromises()
    return { ...route, state: 'published' }
  })
  vi.spyOn(processRouteApi, 'parse').mockResolvedValue({
    title: routeFixture.title,
    serial_nos: routeFixture.serial_nos,
    steps: routeFixture.steps,
    source_data: routeFixture.source_data,
    filename: file.name,
  })
  const attach = vi.spyOn(processRouteApi, 'attachSource')
  const upload = vi.spyOn(processRouteApi, 'uploadDrawing')
  const create = vi.spyOn(processRouteApi, 'create').mockResolvedValue({
    ...routeFixture,
    id: 55,
    version: 1,
    source_data: { ...routeFixture.source_data, review_required: true },
  })
  await renderNew()
  await files('导入工艺单文件', [file])
  await files('上传图纸文件', [drawing])
  expect(create).not.toHaveBeenCalled()
  expect(wrapper.getComponent(WordDocumentPreview).props('sourceFile')).toBe(file)
  await wrapper.get('.route-import-confirmation input[type="checkbox"]').setValue(true)
  await click('保存工艺')
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ id: 0, serial_nos: ['S-001'] }),
    file,
    [drawing],
  )
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(attach).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
  expect(processRouteApi.publish).toHaveBeenCalledWith(expect.objectContaining({ id: 55 }), true)
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(false)
  expect(wrapper.emitted('saved')).toHaveLength(1)
})
it('blocks unsupported or oversized drawings and limits the combined file count', async () => {
  await renderNew()
  await files('上传图纸文件', [new File(['dwg'], '图纸.dwg')])
  expect(wrapper.text()).toContain('非空 PDF')
  expect(wrapper.find('.route-drawing-list').exists()).toBe(false)
  await files(
    '上传图纸文件',
    Array.from({ length: 11 }, (_, i) => new File(['pdf'], `${i}.pdf`)),
  )
  expect(wrapper.text()).toContain('最多上传 10 份')
  expect(wrapper.find('.route-drawing-list').exists()).toBe(false)
  await files('上传图纸文件', [new File([new Uint8Array(5 * 1024 * 1024 + 1)], '大图.pdf')])
  expect(wrapper.find('.route-drawing-list').exists()).toBe(false)
})
it('retains failed drawing uploads for retry and never publishes with a missing upload', async () => {
  const file = new File(['pdf'], '图纸.pdf')
  const saved = { ...routeFixture, id: 55, drawings: [] }
  vi.mocked(processRouteApi.save).mockResolvedValue(saved)
  vi.spyOn(processRouteApi, 'uploadDrawing')
    .mockRejectedValueOnce(new Error('图纸上传失败'))
    .mockResolvedValueOnce({
      ...saved,
      version: 3,
      drawings: [{ id: 71, filename: file.name, size_bytes: file.size }],
    })
  await render()
  await files('上传图纸文件', [file])
  await click('保存工艺')
  expect(processRouteApi.publish).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('图纸上传失败')
  expect(wrapper.text()).toContain('待保存')
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(true)
  expect(wrapper.emitted('saved')).toBeUndefined()
  await click('保存工艺')
  expect(processRouteApi.uploadDrawing).toHaveBeenCalledTimes(2)
  expect(processRouteApi.publish).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
})
it('keeps a read-only four-column process table without execution settings or scheduling controls', async () => {
  await render(true, {
    ...routeFixture,
    execution_labels: { tasks: { 4: '精磨任务' }, purposes: { 3: '产品业务' } },
  })
  expect(wrapper.find('table[aria-label="工艺工序"]').exists()).toBe(true)
  expect(wrapper.findAll('.route-edit-step')).toHaveLength(4)
  expect(wrapper.findAll('.route-step-table thead th').map((cell) => cell.text())).toEqual([
    '序号',
    '执行班组',
    '工艺要求',
    '计划加工数量',
  ])
  expect(wrapper.find('.route-execution-row').exists()).toBe(false)
  expect(wrapper.find('.route-execution-toggle').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('建立工艺排期')
  expect(wrapper.find('input[placeholder="选择流水号"]').exists()).toBe(false)
  expect(wrapper.findAll('.route-edit-step input, .route-edit-step textarea')).toHaveLength(0)
  expect(wrapper.findAll('.route-edit-step')[1]!.get('.route-instructions-cell').text()).toContain(
    '厚度2.5',
  )
})
it('shows original and drawing thumbnails together in details without a tabbed preview pane', async () => {
  await render(true, {
    ...routeFixture,
    source_data: { ...routeFixture.source_data, order_document: orderFixture },
    drawings: [
      { id: 71, filename: '零件.pdf', size_bytes: 100 },
      { id: 72, filename: '装配.pdf', size_bytes: 100 },
    ],
  })
  expect(wrapper.find('.route-original-panel').exists()).toBe(false)
  expect(wrapper.findAll('.route-attachment-card')).toHaveLength(3)
  expect(wrapper.getComponent(WordDocumentPreview).props('thumbnail')).toBe('')
  expect(
    wrapper
      .findAllComponents(ProcessRouteDrawingPreview)
      .map((preview) => preview.props('drawing')!.id),
  ).toEqual([71, 72])
  expect(wrapper.find('button[aria-label="放大订单表"]').exists()).toBe(false)
})
it('shows only the main serial without offering inferred associations or rewriting old bindings', async () => {
  await render(false, {
    ...routeFixture,
    serial_nos: ['691236-50', '691236-49', '691236-51'],
    source_data: {
      ...routeFixture.source_data,
      order_document: { ...orderFixture, serial_no: '691236-50' },
    },
  })
  expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', '691236-50')
  expect(wrapper.find('input[aria-label="共投关联流水号"]').exists()).toBe(false)
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledWith(
    expect.objectContaining({
      serial_nos: ['691236-50', '691236-49', '691236-51'],
      source_data: {
        ...routeFixture.source_data,
        order_document: { ...orderFixture, serial_no: '691236-50' },
      },
    }),
  )
})
it('opens either original viewer without replacing the unsaved form', async () => {
  await render(false, {
    ...routeFixture,
    drawings: [{ id: 71, filename: '图纸.pdf', size_bytes: 100 }],
  })
  await wrapper.get('input[aria-label="流水号"]').setValue('UNSAVED')
  await wrapper.get('button[aria-label="放大工艺原稿"]').trigger('click')
  expect(openWord).toHaveBeenCalledOnce()
  await wrapper.get('button[aria-label="放大图纸"]').trigger('click')
  expect(openDrawing).toHaveBeenCalledOnce()
  expect(wrapper.get('.route-comparison').classes()).not.toContain('route-comparison--expanded')
  expect(wrapper.text()).not.toContain('返回工艺')
  expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'UNSAVED')
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('corrects an unpublished import that inferred extra serials from instructions', async () => {
  const route = structuredClone(routeFixture)
  route.serial_nos = ['691236-50', '691236-49', '691236-51']
  route.source_data.order_document!.serial_no = '691236-50'
  route.source_data.receipt_fields = {
    serial_no: { value: '691236-50', label: '流水号', source_label: '流水号', source_row: '1:5' },
  }
  route.steps[0]!.instructions = '691236-49,691236-50,691236-51共投'
  await render(false, route)
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledWith(
    expect.objectContaining({ serial_nos: ['691236-50'] }),
  )
  expect(vi.mocked(processRouteApi.save).mock.calls[0]![0].steps[0]!.instructions).toBe(
    '691236-49,691236-50,691236-51共投',
  )
})

it('does not persist an empty revision just by entering edit mode', async () => {
  await render(true)
  expect(wrapper.text()).not.toContain('保存草稿')
  expect(wrapper.text()).not.toContain('发布工艺')
  await click('修改工艺')
  expect(processRouteApi.revise).not.toHaveBeenCalled()
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('保存工艺')
  await click('保存工艺')
  expect(processRouteApi.revise).toHaveBeenCalledWith(routeFixture.id)
  expect(processRouteApi.save).toHaveBeenCalledWith(
    expect.objectContaining({ id: 9, parent_id: routeFixture.id }),
  )
  expect(processRouteApi.publish).toHaveBeenCalledOnce()
})
it('starts editing from the list action without creating a revision until saving', async () => {
  await render(true, routeFixture, false, true)
  expect(wrapper.text()).toContain('保存工艺')
  expect(wrapper.text()).not.toContain('修改工艺')
  expect(wrapper.find('input[aria-label="流水号"]').exists()).toBe(true)
  expect(processRouteApi.revise).not.toHaveBeenCalled()
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('does not let the direct-edit flag enable a view-only route', async () => {
  await render(true, routeFixture, true, true)
  expect(wrapper.text()).not.toContain('保存工艺')
  expect(wrapper.find('input[aria-label="流水号"]').exists()).toBe(false)
  expect(processRouteApi.revise).not.toHaveBeenCalled()
})
it('marks duplicate sequence cells locally and clears their markers after correction', async () => {
  const route = structuredClone(routeFixture)
  route.steps[2]!.sequence_no = 1
  await render(false, route)
  expect(wrapper.findAll('[aria-label="序号重复"]')).toHaveLength(2)
  expect(wrapper.findAll('.route-cell--issue')).toHaveLength(2)
  expect(wrapper.find('.route-edit-step--duplicate').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('导入提醒')
  expect(wrapper.text()).not.toContain('发布前须人工核对')
  await click('保存工艺')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  await wrapper.findAll('.route-edit-step .el-input-number input')[2]!.setValue('2')
  await flushPromises()
  expect(wrapper.find('[aria-label="序号重复"]').exists()).toBe(false)
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledOnce()
})
it('keeps original duplicate rows visible as plain table cells in details', async () => {
  const route = structuredClone(routeFixture)
  route.steps[2] = { ...route.steps[1]!, source_row: '1:20' }
  await render(true, route)
  expect(wrapper.findAll('.route-edit-step')).toHaveLength(4)
  expect(wrapper.findAll('[aria-label="序号重复"]')).toHaveLength(2)
  expect(wrapper.findAll('.route-edit-step input, .route-edit-step textarea')).toHaveLength(0)
  expect(wrapper.findAll('.route-edit-step')[1]!.text()).toBe(
    wrapper.findAll('.route-edit-step')[2]!.text(),
  )
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('uses a compact marker for unrecognized rows and flags imported missing values in their fields', async () => {
  const route = structuredClone(routeFixture)
  route.source_data.issues = ['表1第99行列数不完整，请人工核对']
  route.steps[1]!.name = ''
  route.steps[2]!.instructions = ''
  route.steps[3]!.sequence_no = 1
  await render(false, route)
  await wrapper.get('.route-issue-summary').trigger('click')
  await flushPromises()
  expect(document.querySelector('[aria-label="原稿含未识别行"]')?.getAttribute('title')).toBe(
    '原表 1 · 第 99 行未识别',
  )
  expect(wrapper.findAll('.route-cell--issue')).toHaveLength(4)
  expect(wrapper.text()).not.toContain('列数不完整')
  expect(wrapper.text()).not.toContain('请人工核对')
  await click('保存工艺')
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('shows saved identity and notes as readable facts without editable-looking fields', async () => {
  await render(true, {
    ...routeFixture,
    engineering_employee_name: '张工',
    modified_employee_name: '李工',
    modified_employee_id: 13,
    updated_at: '2026-10-24T10:52:00',
  })
  const summary = wrapper.get('[aria-label="工艺基本信息"]')
  expect(summary.text()).toContain('S-001')
  expect(summary.text()).toContain('张工')
  expect(summary.text()).toContain('李工')
  expect(summary.text()).toContain('2026-10-24')
  expect(wrapper.find('input[aria-label="流水号"]').exists()).toBe(false)
  expect(wrapper.get('form').findAll('input,textarea')).toHaveLength(0)
  expect(wrapper.get('.route-review-text').text()).toBe(routeFixture.review_note)
})
it('locates a warning in the original and keeps both original duplicate rows', async () => {
  const route = structuredClone(routeFixture)
  route.steps[2]!.sequence_no = 1
  await render(true, route)
  expect(wrapper.get('.route-issue-summary').text()).toContain('2 处待核对')
  await wrapper.get('.route-issue-summary').trigger('click')
  await flushPromises()
  const choices = document.querySelectorAll<HTMLButtonElement>('.route-issue-choice')
  expect(choices).toHaveLength(2)
  choices[1]!.click()
  await flushPromises()
  expect(wrapper.getComponent(WordDocumentPreview).props('sourceRow')).toBe('1:3')
  expect(openWord).toHaveBeenCalledOnce()
  expect(wrapper.findAll('.route-edit-step')).toHaveLength(4)
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('shows only a short drawing empty state while retaining upload validation', async () => {
  await renderNew()
  expect(wrapper.get('[aria-label="工艺附件缩略图"]').text()).toContain('图纸未上传')
  expect(wrapper.text()).not.toContain('仅保存与查看')
  expect(wrapper.text()).not.toContain('每份 ≤')
  expect(wrapper.text()).not.toContain('可直接填写工艺')
  await files('上传图纸文件', [new File(['bad'], '错误.dwg')])
  expect(wrapper.text()).toContain('请上传非空 PDF 图纸')
})
it('stages drawing removal and removes only the copied attachment when saving a revision', async () => {
  const drawing = { id: 71, filename: '图纸.pdf', size_bytes: 100, sha256: 'drawing-hash' }
  const revision = {
    ...structuredClone(routeFixture),
    id: 9,
    parent_id: routeFixture.id,
    drawings: [{ ...drawing, id: 72 }, ...(routeFixture.drawings || [])],
  }
  vi.mocked(processRouteApi.revise).mockResolvedValue(revision)
  vi.mocked(processRouteApi.save).mockResolvedValue({ ...revision, version: 2 })
  vi.spyOn(processRouteApi, 'removeDrawing').mockResolvedValue({
    ...revision,
    version: 3,
    drawings: routeFixture.drawings,
  })
  await render(true, { ...routeFixture, drawings: [drawing, ...(routeFixture.drawings || [])] })
  await click('修改工艺')
  await wrapper.get('button[aria-label="移除 图纸.pdf"]').trigger('click')
  expect(processRouteApi.removeDrawing).not.toHaveBeenCalled()
  expect(processRouteApi.revise).not.toHaveBeenCalled()
  await click('保存工艺')
  expect(processRouteApi.removeDrawing).toHaveBeenCalledWith(
    expect.objectContaining({ id: 9, version: 2 }),
    72,
  )
  expect(processRouteApi.publish).toHaveBeenCalledWith(
    expect.objectContaining({ id: 9, version: 3, drawings: routeFixture.drawings }),
  )
})

it('shows missing attachment cards and actual execution team names on legacy details', async () => {
  await render(true, {
    ...routeFixture,
    filename: '',
    drawings: [],
    source_data: { tables: [], issues: [] },
  })
  expect(wrapper.findAll('.route-attachment-card--missing')).toHaveLength(2)
  expect(wrapper.get('[aria-label="工艺附件缩略图"]').text()).not.toContain('订单表')
  expect(wrapper.findAll('.route-edit-step td:nth-child(2)')[0]!.text()).toBe('库房')
  expect(wrapper.findAll('.route-edit-step td:nth-child(2)')[1]!.text()).toBe('研磨')
  expect(wrapper.find('.route-original-panel').exists()).toBe(false)
})
it.each(['工艺原件', '图纸'])(
  'blocks saving a normal route missing %s before any write',
  async (missing) => {
    const route = structuredClone(routeFixture)
    if (missing === '工艺原件') route.filename = ''
    if (missing === '图纸') route.drawings = []
    await render(false, route)
    await click('保存工艺')
    expect(wrapper.text()).toContain(`缺少：${missing}`)
    expect(processRouteApi.save).not.toHaveBeenCalled()
    expect(processRouteApi.publish).not.toHaveBeenCalled()
  },
)

it('shows material beside the serial and retains corrections after saving', async () => {
  await render(false, {
    ...routeFixture,
    source_data: {
      ...routeFixture.source_data,
      receipt_fields: {
        material_name: {
          value: 'Mo70Cu30',
          label: '材质',
          source_kind: 'word',
          source_label: '材质',
          source_row: '1:1',
        },
      },
    },
  })
  expect(wrapper.get('input[aria-label="材质"]').element).toHaveProperty('value', 'Mo70Cu30')
  await wrapper.get('input[aria-label="材质"]').setValue('Mo80Cu20')
  await click('保存工艺')
  expect(
    vi.mocked(processRouteApi.save).mock.calls[0]![0].source_data.receipt_fields?.material_name
      ?.value,
  ).toBe('Mo80Cu20')
  expect((wrapper.get('input[aria-label="材质"]').element as HTMLInputElement).value).toBe(
    'Mo80Cu20',
  )
  expect(wrapper.getComponent(AppDialog).props('modelValue')).toBe(false)
})
it('allows a missing material to be filled without inventing an imported source', async () => {
  await render()
  await wrapper.get('input[aria-label="材质"]').setValue('CuW80')
  await click('保存工艺')
  expect(
    vi.mocked(processRouteApi.save).mock.calls[0]![0].source_data.receipt_fields?.material_name,
  ).toMatchObject({ value: 'CuW80', source_kind: 'manual' })
})
it('keeps thumbnails on the left and team selection in the same column across view modes', async () => {
  await render(true)
  const layout = wrapper.get('.route-comparison')
  expect(layout.element.firstElementChild?.getAttribute('aria-label')).toBe('工艺附件缩略图')
  expect(wrapper.find('.route-original-panel').exists()).toBe(false)
  await click('修改工艺')
  expect(layout.element.firstElementChild?.getAttribute('aria-label')).toBe('工艺附件缩略图')
  expect(wrapper.getComponent(WordDocumentPreview).props('thumbnail')).toBe('')
  expect(wrapper.find('.route-original-panel').exists()).toBe(false)
  const team = wrapper.get('.route-edit-step td:nth-child(2)')
  expect(team.find('[aria-label="工序 1 执行班组"]').exists()).toBe(true)
  expect(team.text()).toContain('库房')
  wrapper.unmount()
  await renderNew()
  expect(
    wrapper.get('.route-comparison').element.firstElementChild?.getAttribute('aria-label'),
  ).toBe('工艺附件缩略图')
  expect(wrapper.find('input[aria-label="材质"]').exists()).toBe(true)
})
