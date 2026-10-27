/* Standalone visual prototype. All operations stay in memory; no business API calls. */
const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]
const icon = (name) => `<img class="icon" src="./icons/${name}.svg" alt="" />`
const inventory = [
  {
    serial: '805881-5',
    material: 'W80',
    type: '半成品',
    step: '02 · 精加工',
    dimensions: '100 × 80 × 2.50',
    quantity: 34,
    weight: 12.75,
    status: 'pending',
  },
  {
    serial: '628349-16',
    material: '铜钼',
    type: '半成品',
    step: '01 · 粗加工',
    dimensions: '80 × 60 × 3.20',
    quantity: 120,
    weight: 18.36,
    status: 'done',
  },
  {
    serial: '823766',
    material: 'W80',
    type: '原材料',
    step: '01 · 粗加工',
    dimensions: '200 × 120 × 8.00',
    quantity: 6,
    weight: 42.56,
    status: 'pending',
  },
  {
    serial: '805881-5',
    material: 'W80',
    type: '半成品',
    step: '02 · 精加工',
    dimensions: '100 × 80 × 2.50',
    quantity: 48,
    weight: 18,
    status: 'done',
  },
  {
    serial: '628349-16',
    material: '铜钼',
    type: '半成品',
    step: '02 · 精加工',
    dimensions: '80 × 60 × 2.80',
    quantity: 60,
    weight: 8.96,
    status: 'partial',
  },
  {
    serial: '823766',
    material: 'W80',
    type: '半成品',
    step: '01 · 粗加工',
    dimensions: '120 × 80 × 5.00',
    quantity: 16,
    weight: 25.68,
    status: 'done',
  },
  {
    serial: '805881-5',
    material: 'W80',
    type: '废料',
    step: '加工废料',
    dimensions: '—',
    quantity: 0,
    weight: 0.685,
    status: 'waste',
  },
  {
    serial: '628349-16',
    material: '铜钼',
    type: '原材料',
    step: '01 · 粗加工',
    dimensions: '160 × 100 × 6.00',
    quantity: 12,
    weight: 32.4,
    status: 'pending',
  },
]
// Match the current workspace's module availability. Permissions remain in the real app.
const modules = [
  ['inventory', '库存明细', 'stock'],
  ['schedule', '交货排期', 'delivery-schedule'],
  ['incoming', '来料待签收', 'pending'],
  ['receipts', '入库记录', 'receipts'],
  ['processing', '加工记录', 'processing'],
  ['inspection-results', '检验记录', 'inspection-results'],
  ['quality', '质量反馈', 'quality-feedback'],
  ['inspections', '巡检记录', 'inspections'],
  ['outbound', '出库记录', 'outgoing'],
  ['reallocations', '转投记录', 'reallocations'],
  ['losses', '丢失记录', 'losses'],
  ['materials', '材质库存', 'materials'],
  ['material-types', '类型库存', 'material-types'],
  ['history', '收发历史', 'history'],
  ['warehouse', '仓库管理', 'warehouse'],
]
const teamIds = { 库房: 1, 轧制: 2, 退火: 5, 研磨: 3, 线切割: 6, 雕刻: 7, 电镀: 8, 检验: 4 }
let currentTeam = '轧制'
let extraFilters = {}
let menuRow = null
let scanReceiver = ''
let activeStatus = ''
let activeType = ''
let currentTab = 'inventory'
let visibleRows = inventory
let selectedEmployee = ''
let currentBatch = inventory[0]
const selectedRows = new Set()
let toastTimer
const statusNames = { pending: '待加工', done: '加工完成', partial: '部分加工', waste: '废料另计' }
inventory.forEach((row, index) =>
  Object.assign(row, {
    purpose: `业务${(index % 2) + 1}`,
    source: index === 4 ? '检验' : index % 3 === 0 ? '本班组加工' : '库房',
    rework: index === 4,
    role: row.status === 'done' ? '加工产出' : row.status === 'waste' ? '加工废料' : '未加工余料',
    due: index === 6 ? '—' : `10-${index % 2 ? '25' : '24'} 16:00`,
    schedule: index === 6 ? '不考核' : '进行中',
    urgent: index === 0 || index === 4,
    location: index === 2 ? '' : `A-${String(index + 1).padStart(2, '0')}`,
    activity: `2026-10-${23 - (index % 4)} 14:30`,
    stockAge: index % 4,
    inTransit: index === 1 ? 20 : 0,
    availableQuantity: row.quantity,
    availableWeight: row.weight,
    shortage: 0,
    customer: index % 2 ? 'CA-02' : 'CA-01',
    product: `RP-${index + 101}`,
    finishedSpec: '80 × 60 × 2.00 mm',
    finishedQuantity: row.quantity,
    lostQuantity: 0,
    lostWeight: 0,
    employee: '张建国',
    batch: `TL20261023000${String(index + 8).padStart(2, '0')}`,
  }),
)
// Every inventory field remains available even when it is outside the initial viewport.
const columns = [
  ['serial', '流水号', true],
  ['material', '材质', true],
  ['type', '物料类型', true],
  ['rework', '返工属性', true],
  ['role', '加工分类', true],
  ['dimensions', '实际尺寸', true],
  ['purpose', '本班组业务', true],
  ['source', '上序班组', true],
  ['quantity', '库存件数', true],
  ['weight', '库存重量（kg）', true],
  ['step', '工艺工序', true],
  ['due', '要求交货时间', true],
  ['schedule', '排期状态', true],
  ['status', '加工状态', true],
  ['stockStatus', '库存状态', true],
  ['shortage', '重量差异（kg）', false],
  ['availableQuantity', '可转出件数', false],
  ['availableWeight', '可转出重量（kg）', false],
  ['inTransit', '待签收件数', false],
  ['inTransitWeight', '待签收重量（kg）', false],
  ['onHandQuantity', '未转出件数', false],
  ['onHandWeight', '未转出重量（kg）', false],
  ['customer', '客户编号', false],
  ['product', '产品编号', false],
  ['finishedSpec', '成品规格', false],
  ['finishedQuantity', '应发成品件数', false],
  ['urgent', '加急状态', false],
  ['activity', '最近流转时间', false],
  ['lostQuantity', '累计丢失件数', false],
  ['lostWeight', '累计丢失重量（kg）', false],
  ['availableTotalQuantity', '可用件数', false],
  ['availableTotalWeight', '可用重量（kg）', false],
  ['pendingOutQuantity', '转出待确认件数', false],
  ['pendingOutWeight', '转出待确认重量（kg）', false],
  ['scrapQuantity', '废料库存件数', false],
  ['scrapWeight', '废料库存（kg）', false],
]
const visibleColumns = new Set(columns.filter(([, , visible]) => visible).map(([key]) => key))
const defaultColumnOrder = columns.map(([key]) => key)
const escapeText = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
const statuses = (row) =>
  `<span class="status-pill ${row.status}">${statusNames[row.status]}</span>`
const typeBadge = (row) =>
  `<span class="badge ${row.type === '废料' ? 'warm' : ''}">${row.type}</span>`
function workspacePath(tab = currentTab, row) {
  const params = new URLSearchParams({ tab: modules.find(([key]) => key === tab)?.[2] || 'stock' })
  if (row) params.set(tab === 'schedule' ? 'serial_no' : 'query', row.serial)
  return `/team-workspaces/${teamIds[currentTeam]}?${params}`
}
function availableModules() {
  return modules.filter(
    ([key]) =>
      (key !== 'warehouse' || currentTeam === '库房') &&
      (key !== 'inspection-results' || currentTeam === '检验') &&
      (!['processing', 'inspections'].includes(key) || currentTeam !== '库房'),
  )
}
function toast(message) {
  const el = $('#toast')
  el.querySelector('span').textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el.hidden = true
  }, 2600)
}
function closePopovers(except) {
  $$('.popover').forEach((item) => {
    if (item !== except) item.hidden = true
  })
  $$('.popover-anchor > button').forEach((button) =>
    button.setAttribute(
      'aria-expanded',
      String(
        !(
          document.getElementById(button.getAttribute('aria-controls')) || button.nextElementSibling
        )?.hidden,
      ),
    ),
  )
}
function togglePopover(button, panel) {
  const open = panel.hidden
  closePopovers()
  panel.hidden = !open
  button.setAttribute('aria-expanded', String(open))
}
function renderModules() {
  const items = availableModules()
  $('#workspaceTabs').innerHTML = items
    .map(
      ([key, name]) =>
        `<button class="tab ${currentTab === key ? 'active' : ''}" role="tab" aria-selected="${currentTab === key}" data-tab="${key}">${name}${key === 'incoming' ? '<span class="count">4</span>' : key === 'quality' ? '<span class="count">2</span>' : ''}</button>`,
    )
    .join('')
  $('#moduleList').innerHTML =
    `<div class="module-grid">${items.map(([key, name]) => `<button class="${currentTab === key ? 'selected' : ''}" data-module="${key}" role="menuitem">${name}${currentTab === key ? '<span>当前</span>' : ''}</button>`).join('')}</div>`
  $('#moduleCount').textContent = `${items.length} 项`
  $$('[data-tab], [data-module]').forEach((button) =>
    button.addEventListener('click', () => selectTab(button.dataset.tab || button.dataset.module)),
  )
  $('#createBtn').hidden = currentTeam === '库房'
  $('#inspectionBtn').hidden = currentTeam !== '检验'
  $('#receiptBtn').hidden = currentTeam !== '库房'
  $('#createBtn span').textContent = '加工登记'
  $('#purposeFilter').innerHTML =
    `<option value="">全部业务</option><option>${currentTeam}业务1</option><option>${currentTeam}业务2</option>`
  requestAnimationFrame(updateTabArrows)
}
function selectTab(key) {
  currentTab = key
  const name = modules.find(([value]) => value === key)[1]
  $('#panelTitle').textContent = name
  $('#currentSection').textContent = name
  closePopovers()
  resetFilters()
  renderModules()
  $('#workspaceTabs .active').scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'smooth',
  })
}
function updateTabArrows() {
  const track = $('#tabsTrack')
  $('#tabsPrevBtn').disabled = track.scrollLeft < 2
  $('#tabsNextBtn').disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2
}
function columnValue(row, key) {
  if (key === 'purpose') return currentTeam + row.purpose
  if (key === 'rework') return row.rework ? '待返工' : '—'
  if (key === 'status') return statusNames[row.status]
  if (key === 'stockStatus') return row.type === '废料' ? '可处理' : '可出库'
  if (key === 'urgent') return row.urgent ? '加急' : '普通'
  if (key === 'inTransitWeight')
    return row.inTransit ? (row.weight * row.inTransit) / row.quantity : 0
  if (key === 'onHandQuantity') return row.quantity - row.inTransit
  if (key === 'onHandWeight') return row.weight - columnValue(row, 'inTransitWeight')
  if (key === 'availableTotalQuantity') return columnValue(row, 'onHandQuantity')
  if (key === 'availableTotalWeight') return columnValue(row, 'onHandWeight')
  if (key === 'pendingOutQuantity') return row.inTransit
  if (key === 'pendingOutWeight') return columnValue(row, 'inTransitWeight')
  if (key === 'scrapQuantity') return row.type === '废料' ? '—' : 0
  if (key === 'scrapWeight') return row.type === '废料' ? row.weight : 0
  if (key === 'quantity' && row.type === '废料') return '—'
  return row[key] ?? '—'
}
function cell(row, key) {
  const index = inventory.indexOf(row)
  if (key === 'serial')
    return `<button class="serial-link" data-detail="${index}">${row.serial}</button><button class="urgency-button ${row.urgent ? 'is-urgent' : ''}" data-urgent="${index}" title="${row.urgent ? '取消加急' : '设置加急'}" aria-label="${row.serial}${row.urgent ? '取消加急' : '设置加急'}">${icon('Flag')}</button>`
  if (key === 'type') return typeBadge(row)
  if (key === 'status') return statuses(row)
  if (key === 'rework' && row.rework) return '<span class="badge warning">待返工</span>'
  if (key === 'schedule')
    return row.type === '废料'
      ? '—'
      : `<button class="schedule-link" data-schedule="${index}">${row.schedule}${icon('ChevronRight')}</button>`
  const value = columnValue(row, key)
  const numeric = typeof value === 'number'
  return `<span class="${numeric ? 'numeric' : key === 'dimensions' ? 'dimension' : ''}">${numeric && /weight|Weight|shortage/.test(key) ? value.toFixed(3) : escapeText(value)}</span>`
}
function matchesExtra(row) {
  if (extraFilters.purpose && currentTeam + row.purpose !== extraFilters.purpose) return false
  if (extraFilters.material && row.material !== extraFilters.material) return false
  if (extraFilters.source && row.source !== extraFilters.source) return false
  if (extraFilters.rework && row.rework !== (extraFilters.rework === 'true')) return false
  if (extraFilters.urgent && !row.urgent) return false
  if (extraFilters.location && row.location) return false
  if (extraFilters.from && row.activity.slice(0, 10) < extraFilters.from) return false
  if (extraFilters.to && row.activity.slice(0, 10) > extraFilters.to) return false
  if (extraFilters.waiting === 'pending' && row.status !== 'pending') return false
  if (extraFilters.waiting === 'outbound' && !row.inTransit) return false
  if (extraFilters.waiting === 'age' && row.stockAge < 3) return false
  if (extraFilters.event && row.lostQuantity === 0) return false
  if (extraFilters.number !== '' && extraFilters.number !== undefined) {
    const value = Number(row[extraFilters.field])
    const target = Number(extraFilters.number)
    if (extraFilters.operator === 'gte' && value < target) return false
    if (extraFilters.operator === 'lte' && value > target) return false
    if (extraFilters.operator === 'eq' && value !== target) return false
  }
  return true
}
function render() {
  const query = $('#searchInput').value.trim().toLowerCase()
  visibleRows = inventory.filter(
    (row) =>
      (!activeStatus || row.status === activeStatus) &&
      (!activeType || row.type === activeType) &&
      matchesExtra(row) &&
      [row.serial, row.material, row.step, row.source, currentTeam + row.purpose].some((value) =>
        value.toLowerCase().includes(query),
      ),
  )
  if (currentTab === 'processing')
    visibleRows = visibleRows.filter((row) => ['done', 'partial'].includes(row.status))
  if (currentTab === 'incoming') visibleRows = visibleRows.filter((row) => row.status === 'pending')
  const shown = columns.filter(([key]) => visibleColumns.has(key))
  $('#tableHead').innerHTML =
    `<tr><th><input type="checkbox" id="selectAll" aria-label="选择本页全部记录" /></th>${shown.map(([key, name]) => `<th data-col="${key}">${currentTab === 'processing' && key === 'quantity' ? '完成件数' : currentTab === 'processing' && key === 'weight' ? '产出重量（kg）' : name}</th>`).join('')}<th class="actions">操作</th></tr>`
  $('#tableBody').innerHTML = visibleRows
    .map((row) => {
      const index = inventory.indexOf(row)
      const canProcess = currentTeam !== '库房' && row.type !== '废料'
      return `<tr data-row="${index}" class="${selectedRows.has(index) ? 'checked' : ''}"><td><input type="checkbox" class="row-check" ${selectedRows.has(index) ? 'checked' : ''} aria-label="选择 ${row.serial} ${row.step}" /></td>${shown.map(([key]) => `<td data-col="${key}">${cell(row, key)}</td>`).join('')}<td class="action-cell"><div class="inventory-row-actions"><button class="row-action" data-detail="${index}">明细</button>${canProcess ? `<button class="row-action" data-open="${index}">加工</button>` : ''}${currentTeam === '检验' && row.quantity > 0 ? `<button class="row-action" data-inspect="${index}">检验</button>` : ''}<button class="row-action action-dispatch" data-dispatch="${index}">出库</button><button class="icon-button row-more" data-row-menu="${index}" aria-label="${row.serial} 更多操作" aria-haspopup="menu">${icon('Dots')}</button></div></td></tr>`
    })
    .join('')
  $('#recordCount').textContent = `${visibleRows.length} 条记录`
  $('#totalInfo').textContent =
    `共 ${visibleRows.length} 条${modules.find(([key]) => key === currentTab)[1]}记录`
  $('#emptyState').hidden = visibleRows.length !== 0
  $('.table-scroll').hidden = visibleRows.length === 0
  const hasExtraFilters = Object.entries(extraFilters).some(
    ([key, value]) =>
      !['field', 'operator'].includes(key) &&
      value !== '' &&
      value !== false &&
      value !== undefined,
  )
  $('#filterDot').hidden = !activeType && !activeStatus && !hasExtraFilters
  $$('[data-status]').forEach((button) =>
    button.classList.toggle('active', button.dataset.status === activeStatus),
  )
  function updateSelection() {
    const boxes = $$('.row-check')
    $('#selectAll').checked = boxes.length > 0 && boxes.every((box) => box.checked)
    $('#selectAll').indeterminate = boxes.some((box) => box.checked) && !$('#selectAll').checked
    $('#dispatchBtn').innerHTML =
      icon('Plus') + (selectedRows.size ? `批量出库（${selectedRows.size}）` : '新建出库')
  }
  $('#selectAll').addEventListener('change', (event) => {
    visibleRows.forEach((row) => {
      const index = inventory.indexOf(row)
      event.target.checked ? selectedRows.add(index) : selectedRows.delete(index)
    })
    render()
  })
  $$('.row-check').forEach((box) =>
    box.addEventListener('change', () => {
      const row = box.closest('tr')
      const index = Number(row.dataset.row)
      box.checked ? selectedRows.add(index) : selectedRows.delete(index)
      row.classList.toggle('checked', box.checked)
      updateSelection()
    }),
  )
  updateSelection()
  $$('[data-open]').forEach((button) =>
    button.addEventListener('click', () => openProcessing(inventory[button.dataset.open])),
  )
  $$('[data-detail]').forEach((button) =>
    button.addEventListener('click', () => openDetails(inventory[button.dataset.detail])),
  )
  $$('[data-dispatch]').forEach((button) =>
    button.addEventListener('click', () => openFeature('出库', inventory[button.dataset.dispatch])),
  )
  $$('[data-inspect]').forEach((button) =>
    button.addEventListener('click', () =>
      openFeature('检验登记', inventory[button.dataset.inspect]),
    ),
  )
  $$('[data-schedule]').forEach((button) =>
    button.addEventListener('click', () =>
      openFeature('交货排期', inventory[button.dataset.schedule], 'schedule'),
    ),
  )
  $$('[data-urgent]').forEach((button) =>
    button.addEventListener('click', () => {
      const row = inventory[button.dataset.urgent]
      row.urgent = !row.urgent
      render()
      toast('已更新模拟数据中的加急标记')
    }),
  )
  $$('[data-row-menu]').forEach((button) =>
    button.addEventListener('click', () => openRowMenu(button)),
  )
}
function renderColumnSettings() {
  $('#columnList').innerHTML = columns
    .filter(([key]) => key !== 'serial')
    .map(
      ([key, name]) =>
        `<div class="column-choice"><label><input type="checkbox" data-column="${key}" ${visibleColumns.has(key) ? 'checked' : ''} />${name}</label><button class="icon-button" data-move-column="${key}" data-direction="-1" aria-label="上移${name}">${icon('ChevronDown')}</button><button class="icon-button" data-move-column="${key}" data-direction="1" aria-label="下移${name}">${icon('ChevronDown')}</button></div>`,
    )
    .join('')
  $$('[data-column]').forEach((input) =>
    input.addEventListener('change', () => {
      input.checked
        ? visibleColumns.add(input.dataset.column)
        : visibleColumns.delete(input.dataset.column)
      render()
    }),
  )
  $$('[data-move-column]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const from = columns.findIndex(([key]) => key === button.dataset.moveColumn)
      const to = from + Number(button.dataset.direction)
      if (to <= 0 || to >= columns.length) return
      columns.splice(to, 0, columns.splice(from, 1)[0])
      renderColumnSettings()
      render()
    }),
  )
}
function openRowMenu(button) {
  const row = inventory[button.dataset.rowMenu]
  const panel = $('#rowMenu')
  if (!panel.hidden && menuRow === row) {
    panel.hidden = true
    return
  }
  closePopovers()
  menuRow = row
  panel.innerHTML = `<div class="row-menu-heading">${row.serial}</div>${[
    ['转投', 'reallocations'],
    ['查看转出 / 在途批次', 'outbound'],
    ['交货排期', 'schedule'],
    ['登记丢失', 'losses'],
  ]
    .map(
      ([name, tab]) =>
        `<button role="menuitem" data-row-feature="${name}" data-target-tab="${tab}">${name}</button>`,
    )
    .join('')}`
  panel.hidden = false
  const bounds = button.getBoundingClientRect()
  panel.style.left = `${Math.min(innerWidth - panel.offsetWidth - 12, bounds.right - panel.offsetWidth)}px`
  panel.style.top = `${Math.min(innerHeight - panel.offsetHeight - 12, bounds.bottom + 6)}px`
  $$('[data-row-feature]').forEach((item) =>
    item.addEventListener('click', () =>
      openFeature(item.dataset.rowFeature, row, item.dataset.targetTab),
    ),
  )
}
function openFeature(title, row, tab = 'inventory') {
  closePopovers()
  $('#featureTitle').textContent = title
  $('#featureEyebrow').textContent = currentTeam + '工作台'
  const fields = row
    ? [
        ['流水号', row.serial],
        ['来源批次', row.batch],
        ['材质', row.material],
        ['实际尺寸', row.dimensions],
        ['库存件数', row.type === '废料' ? '不计件数' : row.quantity + ' 件'],
        ['库存重量', row.weight.toFixed(3) + ' kg'],
      ]
    : [
        ['当前班组', currentTeam],
        ['当前模块', modules.find(([key]) => key === currentTab)[1]],
      ]
  const description = title.includes('转投')
    ? '按已选择的物料继续转投，保留原批次与流水号关联。'
    : title.includes('排期')
      ? '查看本流水号的批次目标、各班组交货节点和实际分批转出进度。'
      : title.includes('出库')
        ? '转料人、接收班组、已加工或未加工物料、件数、重量和实际尺寸保持现有流程。'
        : title.includes('入库')
          ? '流水号、原始工艺单导入对照、基础资料、数量重量、规格与共投计划保留在现有表单。'
          : title.includes('设置')
            ? '业务、加工任务、独立员工名单等仍在班组设置中维护。'
            : '在当前系统继续对应操作，权限与校验规则保持不变。'
  $('#featureBody').innerHTML =
    `<p class="feature-description">${description}</p><dl>${fields.map(([name, value]) => `<div><dt>${name}</dt><dd>${escapeText(value)}</dd></div>`).join('')}</dl>`
  $('#featureLink').href = workspacePath(tab, row)
  $('#featureDialog').showModal()
}
function openDetails(row) {
  currentBatch = row
  $('#detailTitle').textContent = row.serial
  const fields = [
    ['材质', row.material],
    ['物料类型', row.type],
    ['当前工序', row.step],
    ['实际尺寸', `${row.dimensions}${row.dimensions === '—' ? '' : ' mm'}`],
    ['库存件数', row.quantity ? `${row.quantity} 件` : '不计件数'],
    ['库存重量', `${row.weight.toFixed(3)} kg`],
    ['加工状态', statusNames[row.status]],
    ['上序班组', '库房'],
  ]
  $('#detailFields').innerHTML = fields
    .map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`)
    .join('')
  $('#detailProcess').hidden =
    currentTeam === '库房' || !['pending', 'partial'].includes(row.status)
  $('#detailDialog').showModal()
}
function openProcessing(row = inventory[0]) {
  if (currentTeam === '库房') return
  currentBatch = row
  $('#batchSerial').textContent = row.serial
  $('#batchMaterial').textContent = row.material
  $('#batchQty').textContent = row.quantity
  $('#batchWeight').textContent = row.weight.toFixed(3)
  $('#quantityInput').max = String(row.quantity || 1)
  $('#quantityInput').value = String(Math.min(24, row.quantity || 1))
  $('#weightInput').value = (row.weight * 0.7).toFixed(3)
  const coarse = row.step.includes('粗加工')
  $('.route-current b').textContent = coarse ? '粗加工' : '精加工'
  $('.route-step-index').textContent = coarse ? '01' : '02'
  $('.route-current small').textContent =
    currentTeam === '轧制'
      ? coarse
        ? '轧制 · 粗轧任务'
        : '轧制 · 精轧任务'
      : `${currentTeam} · 工序样式示例`
  $('.route-preview > div > b').textContent = currentTeam
  $('.requirement p').innerHTML = coarse
    ? '厚度加工至 <strong>2.80 mm</strong>；预留精加工余量。确认轧制方向，表面不得有裂纹，完成后记录实际尺寸。'
    : '厚度加工至 <strong>2.50 ± 0.01 mm</strong>；表面不得有明显划伤。按工艺单确认轧制方向，完成后测量并记录实际尺寸。'
  $('#employeeMenu').hidden = true
  $$('.invalid').forEach((el) => el.classList.remove('invalid'))
  updateTotals(false)
  $('#processingDialog').showModal()
  closePopovers()
}
const tweenFrames = new Map()
function animateValue(selector, target, precision, animate) {
  const element = $(selector)
  cancelAnimationFrame(tweenFrames.get(selector))
  const start = Number(element.textContent) || 0
  const time = performance.now()
  const duration = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 210 : 0
  function frame(now) {
    const p = duration ? Math.min(1, (now - time) / duration) : 1
    element.textContent = (start + (target - start) * (1 - Math.pow(1 - p, 3))).toFixed(precision)
    if (p < 1) tweenFrames.set(selector, requestAnimationFrame(frame))
  }
  frame(time)
}
function updateTotals(animate = true) {
  const quantity = Number($('#quantityInput').value) || 0
  const weight = Number($('#weightInput').value) || 0
  animateValue('#summaryQty', quantity, 0, animate)
  animateValue('#remainingQty', Math.max(0, currentBatch.quantity - quantity), 0, animate)
  animateValue('#summaryWeight', weight, 3, animate)
}
$('#searchInput').addEventListener('input', render)
$('#queryBtn').addEventListener('click', render)
$('#filterBtn').addEventListener('click', () => togglePopover($('#filterBtn'), $('#filterPopover')))
$('#columnsBtn').addEventListener('click', () =>
  togglePopover($('#columnsBtn'), $('#columnsPopover')),
)
$('#moreTabsBtn').setAttribute('aria-controls', 'moduleMenu')
document.body.append($('#moduleMenu'))
$('#moreTabsBtn').addEventListener('click', () => {
  const panel = $('#moduleMenu')
  togglePopover($('#moreTabsBtn'), panel)
  if (panel.hidden) return
  const bounds = $('#moreTabsBtn').getBoundingClientRect()
  panel.style.left = `${Math.min(innerWidth - panel.offsetWidth - 12, bounds.right - panel.offsetWidth)}px`
  panel.style.top = `${Math.min(bounds.bottom + 8, innerHeight - panel.offsetHeight - 12)}px`
})
$('#tabsNextBtn').addEventListener('click', () =>
  $('#tabsTrack').scrollBy({ left: 430, behavior: 'smooth' }),
)
$('#tabsPrevBtn').addEventListener('click', () =>
  $('#tabsTrack').scrollBy({ left: -430, behavior: 'smooth' }),
)
$('#tabsTrack').addEventListener('scroll', updateTabArrows)
addEventListener('resize', () => {
  updateTabArrows()
  closePopovers()
})
$('#applyFilter').addEventListener('click', () => {
  activeType = $('#typeFilter').value
  activeStatus = $('#statusFilter').value
  extraFilters = {
    purpose: $('#purposeFilter').value,
    material: $('#materialFilter').value,
    source: $('#sourceFilter').value,
    rework: $('#reworkFilter').value,
    urgent: $('#urgentFilter').checked,
    location: $('#locationFilter').checked,
    from: $('#dateFrom').value,
    to: $('#dateTo').value,
    waiting: $('#waitingFilter').value,
    event: $('#eventFilter').value,
    field: $('#numericField').value,
    number: $('#numericValue').value,
    operator: $('#numericOperator').value,
  }
  closePopovers()
  render()
})
function resetFilters() {
  activeType = ''
  activeStatus = ''
  extraFilters = {}
  $$('#filterPopover select').forEach((input) => {
    input.selectedIndex = 0
  })
  $$('#filterPopover input').forEach((input) => {
    input.type === 'checkbox' ? (input.checked = false) : (input.value = '')
  })
  $('#searchInput').value = ''
  render()
}
$('#resetFilters').addEventListener('click', resetFilters)
$('#clearSearch').addEventListener('click', resetFilters)
$('#resetColumns').addEventListener('click', () => {
  columns.sort(([a], [b]) => defaultColumnOrder.indexOf(a) - defaultColumnOrder.indexOf(b))
  visibleColumns.clear()
  columns.filter(([, , visible]) => visible).forEach(([key]) => visibleColumns.add(key))
  renderColumnSettings()
  render()
})
$$('[data-status]').forEach((button) =>
  button.addEventListener('click', () => {
    activeStatus = button.dataset.status
    $('#statusFilter').value = activeStatus
    render()
  }),
)
$$('[data-team]').forEach((button) =>
  button.addEventListener('click', () => {
    currentTeam = button.dataset.team
    selectedRows.clear()
    scanReceiver = ''
    selectedEmployee = ''
    $('#employeeValue').textContent = '选择加工人'
    $('#employeeBtn').classList.remove('has-value')
    $$('[data-team]').forEach((item) => {
      item.classList.toggle('selected', item === button)
      item.removeAttribute('aria-current')
    })
    button.setAttribute('aria-current', 'page')
    $('#workspaceTitle').textContent = `${currentTeam}工作台`
    $('.profile-text small').textContent = `${currentTeam}班组长`
    if (!availableModules().some(([key]) => key === currentTab)) currentTab = 'inventory'
    selectTab(currentTab)
  }),
)
$$('[data-nav]').forEach((button) =>
  button.addEventListener('click', () =>
    toast(`${button.dataset.nav}在正式系统中使用，本原型展示工作台样式`),
  ),
)
$('#createBtn').addEventListener('click', () => openProcessing())
$$('[data-close]').forEach((button) =>
  button.addEventListener('click', () => $('#processingDialog').close()),
)
$('#aboutBtn').addEventListener('click', () => $('#aboutDialog').showModal())
$('#closeAbout').addEventListener('click', () => $('#aboutDialog').close())
$('#closeDetail').addEventListener('click', () => $('#detailDialog').close())
$('#detailProcess').addEventListener('click', () => {
  $('#detailDialog').close()
  openProcessing(currentBatch)
})
$('#employeeBtn').addEventListener('click', () => {
  $('#employeeMenu').hidden = !$('#employeeMenu').hidden
  if (!$('#employeeMenu').hidden) $('#employeeSearch').focus()
})
const employees = ['张建国', '王志强', '李文涛', '赵明']
function renderEmployees() {
  const names = employees.filter((name) => name.includes($('#employeeSearch').value))
  $('#employeeList').innerHTML =
    names
      .map(
        (name) =>
          `<button type="button" data-employee="${name}"><span class="avatar">${name[0]}</span>${name}</button>`,
      )
      .join('') || '<p>未找到员工</p>'
  $$('[data-employee]').forEach((button) =>
    button.addEventListener('click', () => {
      selectedEmployee = button.dataset.employee
      $('#employeeValue').textContent = selectedEmployee
      $('#employeeBtn').classList.add('has-value')
      $('#employeeBtn').classList.remove('invalid')
      $('#employeeBtn').removeAttribute('aria-invalid')
      $('#employeeMenu').hidden = true
      $('#employeeBtn').focus()
    }),
  )
}
$('#employeeSearch').addEventListener('input', renderEmployees)
renderEmployees()
$$('[data-delta]').forEach((button) =>
  button.addEventListener('click', () => {
    const input = $('#quantityInput')
    input.value = String(
      Math.max(1, Math.min(Number(input.max), Number(input.value) + Number(button.dataset.delta))),
    )
    updateTotals()
  }),
)
$('#quantityInput').addEventListener('input', () => updateTotals())
$('#weightInput').addEventListener('input', () => updateTotals())
$$('#processingForm input').forEach((input) => {
  input.addEventListener('input', () => {
    const control = input.closest('.number-control, .unit-input') || input
    control.classList.remove('invalid')
    control.removeAttribute('aria-invalid')
  })
})
$('#processingForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const invalid = []
  if (!$('#processingForm input[type=date]').value)
    invalid.push($('#processingForm input[type=date]'))
  if (!selectedEmployee) invalid.push($('#employeeBtn'))
  if (
    Number($('#quantityInput').value) <= 0 ||
    Number($('#quantityInput').value) > currentBatch.quantity
  )
    invalid.push($('.number-control'))
  if (Number($('#weightInput').value) <= 0) invalid.push($('.unit-input'))
  if (invalid.length) {
    invalid.forEach((el) => {
      el.classList.remove('invalid')
      void el.offsetWidth
      el.classList.add('invalid')
      el.setAttribute('aria-invalid', 'true')
    })
    ;(invalid[0].querySelector('input') || invalid[0]).focus()
    return
  }
  $('#processingDialog').close()
  toast(`演示登记完成 · ${selectedEmployee} · ${$('#quantityInput').value} 件，未写入业务系统`)
})
$('#refreshBtn').addEventListener('click', () => {
  $('#refreshBtn img').animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: 450,
    easing: 'ease-in-out',
  })
  render()
  toast('模拟数据已刷新')
})
$('#fullscreenBtn').addEventListener('click', () => {
  $('.app').classList.toggle('focus-mode')
  $('#fullscreenBtn span').textContent = $('.app').classList.contains('focus-mode')
    ? '退出全屏'
    : '全屏查看'
})
$('#exportBtn').addEventListener('click', () => {
  $('#exportScope').textContent =
    `导出当前筛选的 ${visibleRows.length} 条记录，勾选需要保留的字段。`
  $('#exportFields').innerHTML = columns
    .map(
      ([key, name]) =>
        `<label><input type="checkbox" data-export-column="${key}" ${visibleColumns.has(key) ? 'checked' : ''} />${name}</label>`,
    )
    .join('')
  $('#exportFields').classList.remove('invalid')
  $$('[data-export-column]').forEach((input) =>
    input.addEventListener('change', () => $('#exportFields').classList.remove('invalid')),
  )
  $('#exportDialog').showModal()
})
$('#exportSelectAll').addEventListener('click', () => {
  $$('[data-export-column]').forEach((input) => {
    input.checked = true
  })
})
$('#confirmExport').addEventListener('click', () => {
  const chosen = $$('[data-export-column]:checked').map((input) =>
    columns.find(([key]) => key === input.dataset.exportColumn),
  )
  if (!chosen.length) {
    $('#exportFields').classList.remove('invalid')
    void $('#exportFields').offsetWidth
    $('#exportFields').classList.add('invalid')
    return
  }
  const rows = [
    chosen.map(([, name]) => name),
    ...visibleRows.map((row) => chosen.map(([key]) => columnValue(row, key))),
  ]
  const data =
    '\uFEFF' +
    rows
      .map((row) => row.map((value) => '"' + String(value).replace(/"/g, '""') + '"').join(','))
      .join('\r\n')
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '样式原型-当前筛选.csv'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  $('#exportDialog').close()
  toast(`已导出 ${visibleRows.length} 条模拟记录、${chosen.length} 个字段`)
})
$('#settingsBtn').addEventListener('click', () => openFeature('班组设置'))
$('#backBtn').addEventListener('click', () => {
  location.href = workspacePath('inventory')
})
$('#dispatchBtn').addEventListener('click', () => openFeature('新建出库'))
$('#receiptBtn').addEventListener('click', () => openFeature('新建入库'))
$('#inspectionBtn').addEventListener('click', () =>
  openFeature('检验登记', undefined, 'inspection-results'),
)
$('#closeFeature').addEventListener('click', () => $('#featureDialog').close())
$('#closeExport').addEventListener('click', () => $('#exportDialog').close())
$('#closeScan').addEventListener('click', () => $('#scanDialog').close())
$('#scanBarcode').addEventListener('input', () => $('#scanBarcode').classList.remove('invalid'))
$('#scanBtn').addEventListener('click', () => {
  $('#scanEmployees').innerHTML = employees
    .map(
      (name) =>
        `<button class="button ${scanReceiver === name ? 'selected' : ''}" data-receiver="${name}">${name}</button>`,
    )
    .join('')
  $$('[data-receiver]').forEach((button) =>
    button.addEventListener('click', () => {
      scanReceiver = button.dataset.receiver
      $$('[data-receiver]').forEach((item) => item.classList.toggle('selected', item === button))
      $('#scanEmployees').classList.remove('invalid')
    }),
  )
  $('#scanDialog').showModal()
})
$('#confirmScan').addEventListener('click', () => {
  const control = !scanReceiver
    ? $('#scanEmployees')
    : !$('#scanBarcode').value.trim()
      ? $('#scanBarcode')
      : null
  if (control) {
    control.classList.remove('invalid')
    void control.offsetWidth
    control.classList.add('invalid')
    return
  }
  $('#scanDialog').close()
  toast(`模拟接收已核对 · ${scanReceiver} · 未写入业务系统`)
})
$('.profile').addEventListener('click', () => toast(`张建国 · ${currentTeam}班组长（模拟账号）`))
$('.nav-item.group').setAttribute('aria-expanded', 'true')
$('.nav-item.group').addEventListener('click', () => {
  $('.team-nav').hidden = !$('.team-nav').hidden
  $('.nav-item.group').setAttribute('aria-expanded', String(!$('.team-nav').hidden))
})
document.addEventListener('click', (event) => {
  if (!event.target.closest('.popover-anchor, [data-row-menu], #rowMenu, #moduleMenu'))
    closePopovers()
  if (!event.target.closest('.employee-anchor')) $('#employeeMenu').hidden = true
})
document.addEventListener('keydown', (event) => {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === 'k' &&
    !$('#processingDialog').open &&
    !$$('dialog').some((dialog) => dialog.open)
  ) {
    event.preventDefault()
    $('#searchInput').focus()
  }
  if (event.key === 'Escape') closePopovers()
})
renderModules()
renderColumnSettings()
render()
