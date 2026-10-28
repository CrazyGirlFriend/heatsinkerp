// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ProcessRouteEditor from './ProcessRouteEditor.vue'
import WordDocumentPreview from './WordDocumentPreview.vue'
import ProcessRouteDrawingPreview from './ProcessRouteDrawingPreview.vue'
import { processRouteApi, ProcessRouteSerialConflictError } from '@/services/processRouteApi'
import { routeFixture, reworkRouteFixture } from '@/testFixtures/processRoute'
import { defineComponent, h } from 'vue'
import { orderFixture } from '@/testFixtures/processRouteOrder'
import { mergeRouteMaterials } from '@/utils/routeMaterials'
const openWord = vi.fn(),
  openDrawing = vi.fn()
const originalStub = (name: string, open: typeof openWord) =>
  defineComponent({
    name,
    props: ['route', 'sourceFile', 'routeId', 'drawing', 'file', 'sourceRow', 'compact'],
    setup(_props, { expose }) {
      expose({ open, ready: true })
      return () => h('div')
    },
  })
vi.mock('@/stores/teamDirectory', () => ({
  useTeamDirectoryStore: () => ({
    items: [
      { id: 1, code: 'FACTORY-WAREHOUSE', name: '库房', active: true },
      { id: 2, code: 'FACTORY-GRIND', name: '研磨', active: true },
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
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        ScheduleTaskEditor: true,
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        WordDocumentPreview: originalStub('WordDocumentPreview', openWord),
        ProcessRouteDrawingPreview: originalStub('ProcessRouteDrawingPreview', openDrawing),
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
  expect(wrapper.text()).toContain('修改工艺')
})

it('shows imported order fields, requires confirmation, and persists them after uploading the source', async () => {
  const order = {
    ...structuredClone(orderFixture),
    serial_no: routeFixture.serial_nos[0]!,
    receipt_fields: {
      ...structuredClone(orderFixture.receipt_fields),
      serial_no: { ...orderFixture.receipt_fields.serial_no!, value: routeFixture.serial_nos[0]! },
    },
  }
  vi.spyOn(processRouteApi, 'parseOrder').mockResolvedValue(order)
  vi.spyOn(processRouteApi, 'attachOrder').mockImplementation(async (route) => ({
    ...route,
    version: route.version + 1,
    source_data: mergeRouteMaterials(route.source_data, order),
  }))
  await render()
  const input = wrapper.get('input[aria-label="导入订单表文件"]')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [new File(['data'], '订单.xlsx')],
  })
  await input.trigger('change')
  await flushPromises()
  expect(wrapper.text()).toContain('物料与订单资料')
  expect(wrapper.text()).toContain('订单表 · 自动填入')
  expect(wrapper.get('table[aria-label="订单表原始数据"]').text()).toContain('18100')
  await click('保存工艺')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('请确认自动填入的资料和工序')
  const confirm = () =>
    wrapper
      .findAll('label.el-checkbox')
      .find((item) => item.text().includes('已核对自动填入'))!
      .get('input')
  await confirm().setValue(true)
  await wrapper.get('input[aria-label="工艺资料：客户代码"]').setValue('11600-T3')
  expect((confirm().element as HTMLInputElement).checked).toBe(false)
  await confirm().setValue(true)
  await click('保存工艺')
  expect(processRouteApi.attachOrder).toHaveBeenCalledOnce()
  expect(processRouteApi.save).toHaveBeenCalledTimes(2)
  expect(processRouteApi.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      source_data: expect.objectContaining({
        receipt_fields: expect.objectContaining({
          customer_code: expect.objectContaining({ value: '11600-T3' }),
        }),
      }),
    }),
    true,
  )
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
  await click('放大查看')
  expect(openDrawing).toHaveBeenCalledOnce()
  expect(openWord).not.toHaveBeenCalled()
})
it('keeps published steps immutable and offers source/revision actions', async () => {
  await render(true)
  expect(wrapper.text()).not.toContain('删除工序')
  expect(wrapper.text()).not.toContain('保存工艺')
  expect(wrapper.text()).toContain('工艺原稿')
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
  expect(wrapper.get('.route-original-line').text()).toBe('原表 1 · 第 2 行')
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

it('uses the route-specific directory once for repeated visits to the same production team', async () => {
  await render(false, routeFixture)
  expect(processRouteApi.options).toHaveBeenCalledWith(2)
  expect(
    vi.mocked(processRouteApi.options).mock.calls.filter(([teamId]) => teamId === 2),
  ).toHaveLength(1)
  expect(wrapper.text()).not.toContain('班组业务与任务读取失败')
})

async function renderNew() {
  wrapper = mount(ProcessRouteEditor, {
    global: {
      directives: { loading: () => {} },
      stubs: {
        AppDialog: { template: '<div><slot/><slot name="footer"/></div>' },
        ScheduleTaskEditor: true,
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
    '工序名称',
    '工艺要求',
    '计划加工数量',
    '执行设置',
  ])
  expect(wrapper.text()).toContain('暂无原稿')
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(parse).not.toHaveBeenCalled()
  await wrapper.get('input[aria-label="流水号"]').setValue('NEW-001')
  await wrapper.get('textarea[aria-label="工序 1 工艺要求"]').setValue('按来料备料')
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledWith(
    expect.objectContaining({ id: 0, title: 'NEW-001', serial_nos: ['NEW-001'], filename: '' }),
  )
})
it('imports into the current form with a local original and creates only when saving', async () => {
  const file = new File(['word'], '导入工艺.docx')
  vi.spyOn(processRouteApi, 'parse').mockResolvedValue({ ...routeFixture, filename: file.name })
  vi.spyOn(processRouteApi, 'attachSource').mockResolvedValue({
    ...routeFixture,
    id: 55,
    filename: file.name,
    version: 2,
  })
  vi.mocked(processRouteApi.save).mockResolvedValue({
    ...routeFixture,
    id: 55,
    filename: '',
    version: 1,
  })
  await renderNew()
  await files('导入工艺单文件', [file])
  expect(processRouteApi.save).not.toHaveBeenCalled()
  expect(wrapper.getComponent(WordDocumentPreview).props('sourceFile')).toBe(file)
  expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'S-001')
  await wrapper.get('.route-import-confirmation input[type="checkbox"]').setValue(true)
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledTimes(2)
  expect(processRouteApi.attachSource).toHaveBeenCalledWith(
    expect.objectContaining({ id: 55, version: 1 }),
    file,
  )
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
  await click('保存工艺')
  expect(processRouteApi.uploadDrawing).toHaveBeenCalledTimes(2)
  expect(processRouteApi.publish).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
})
it('keeps the same compact step table after publication and shows readable execution names', async () => {
  await render(true, {
    ...routeFixture,
    execution_labels: { tasks: { 4: '精磨任务' }, purposes: { 3: '产品业务' } },
  })
  expect(wrapper.find('table[aria-label="工艺工序"]').exists()).toBe(true)
  expect(wrapper.findAll('.route-edit-step')).toHaveLength(4)
  await wrapper.findAll('.route-edit-step button')[1]!.trigger('click')
  expect(wrapper.get('.route-execution-row').text()).toContain('精磨任务')
  expect(wrapper.get('.route-execution-row').text()).toContain('产品业务')
  expect(wrapper.findAll('.route-edit-step input, .route-edit-step textarea')).toHaveLength(0)
  expect(wrapper.findAll('.route-edit-step')[1]!.get('.route-instructions-cell').text()).toContain(
    '厚度2.5',
  )
})
it('shows only the main serial without offering inferred associations or rewriting old bindings', async () => {
  await render(false, { ...routeFixture, serial_nos: ['691236-50', '691236-49', '691236-51'] })
  expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', '691236-50')
  expect(wrapper.find('input[aria-label="共投关联流水号"]').exists()).toBe(false)
  await click('保存工艺')
  expect(processRouteApi.save).toHaveBeenCalledWith(
    expect.objectContaining({ serial_nos: ['691236-50', '691236-49', '691236-51'] }),
  )
})
it('opens either original viewer without replacing the unsaved form', async () => {
  await render(false, {
    ...routeFixture,
    drawings: [{ id: 71, filename: '图纸.pdf', size_bytes: 100 }],
  })
  await wrapper.get('input[aria-label="流水号"]').setValue('UNSAVED')
  await click('放大查看')
  expect(openWord).toHaveBeenCalledOnce()
  await click('图纸1')
  await click('放大查看')
  expect(openDrawing).toHaveBeenCalledOnce()
  expect(wrapper.get('.route-comparison').classes()).not.toContain('route-comparison--expanded')
  expect(wrapper.text()).not.toContain('返回工艺')
  expect(wrapper.get('input[aria-label="流水号"]').element).toHaveProperty('value', 'UNSAVED')
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('corrects an unpublished import that inferred extra serials from instructions', async () => {
  const route = structuredClone(routeFixture)
  route.serial_nos = ['691236-50', '691236-49', '691236-51']
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
  expect(wrapper.get('.route-original-line').text()).toBe('原表 1 · 第 3 行')
  expect(wrapper.findAll('.route-edit-step')).toHaveLength(4)
  expect(processRouteApi.save).not.toHaveBeenCalled()
})
it('shows only a short drawing empty state while retaining upload validation', async () => {
  await renderNew()
  await click('图纸')
  expect(wrapper.text()).toContain('暂无图纸')
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
    drawings: [{ ...drawing, id: 72 }],
  }
  vi.mocked(processRouteApi.revise).mockResolvedValue(revision)
  vi.mocked(processRouteApi.save).mockResolvedValue({ ...revision, version: 2 })
  vi.spyOn(processRouteApi, 'removeDrawing').mockResolvedValue({
    ...revision,
    version: 3,
    drawings: [],
  })
  await render(true, { ...routeFixture, drawings: [drawing] })
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
    expect.objectContaining({ id: 9, version: 3, drawings: [] }),
  )
})
