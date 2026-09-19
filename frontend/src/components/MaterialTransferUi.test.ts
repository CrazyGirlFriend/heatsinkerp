import { describe, expect, it } from 'vitest'
import drawerSource from './MaterialTransferDrawer.vue?raw'
import formSource from './MaterialTransferFormDialog.vue?raw'
import printSource from './MaterialTransferPrintSheet.vue?raw'
import listSource from '@/pages/TransferBatchesPage.vue?raw'
import scanSource from '@/pages/TransferBatchScanPage.vue?raw'
import traceSource from '@/pages/MaterialTracePage.vue?raw'

describe('pure material transfer interface', () => {
  it('collects document snapshots without introducing a work-order or process workflow', () => {
    expect(formSource).toContain('接收班组')
    expect(formSource).toContain('流水号')
    expect(formSource).toContain('转料件数')
    expect(formSource).toContain('转料重量')
    expect(formSource).toContain('备注')
    expect(formSource).toContain('当前账号自动确定')
    expect(formSource).toContain('物料类型')
    expect(formSource).not.toMatch(/工单号|工艺路线|报工/)
    expect(formSource).toContain('createRequestFingerprint.value !== requestFingerprint')
    expect(formSource).toContain('idempotency_key: createRequestKey.value')
  })

  it('gives the target one whole-batch confirmation action with no receiving inputs', () => {
    expect(drawerSource).toContain('整单确认接收')
    expect(drawerSource).toContain('无需重新录入数量或重量')
    expect(drawerSource).toContain('确认后转出方不能修改')
    expect(drawerSource).not.toContain('received_quantity')
    expect(drawerSource).not.toContain('received_weight')
    expect(drawerSource).not.toContain('<ElInputNumber')
  })

  it('uses Element Plus and whole-page reading layouts for list, scan and trace', () => {
    expect(listSource).toContain('class="page workspace-page transfers-page reading-workspace"')
    expect(listSource).toContain('<ElTable v-else')
    expect(listSource).not.toContain('height="100%"')
    expect(scanSource).toContain('class="page workspace-page material-scan-page reading-workspace"')
    expect(traceSource).toContain('class="page workspace-page material-trace-page reading-workspace"')
    expect(traceSource).toContain('<SerialBatchGraph')
    for (const source of [listSource, scanSource, traceSource, drawerSource, formSource]) {
      expect(source).not.toContain("from '@ant-design/icons-vue'")
    }
  })

  it('supports HID Code 128 scanning without intercepting form entry', () => {
    for (const source of [listSource, scanSource]) {
      expect(source).toContain('isEditableTarget(event.target)')
      expect(source).toContain("event.key === 'Enter'")
      expect(source).toContain('/^(?:TL|CK)[A-Z0-9-]{4,}$/')
      expect(source).toContain('materialTransferApi.get(batchNo)')
    }
  })

  it('traces only a serial-number handoff chain and reports the current state', () => {
    expect(traceSource).toContain('materialTransferApi.trace(serialNo)')
    expect(traceSource).toContain('在库分布')
    expect(traceSource).toContain('批次流向')
    expect(traceSource).not.toContain('最近确认位置')
    expect(traceSource).not.toMatch(/WorkOrder|workOrder|工艺主线|工单信息|产品/)
  })

  it('prints a teleported Code 128 transfer sheet containing only handoff facts', () => {
    expect(drawerSource).toContain('<Teleport to="body">')
    expect(drawerSource).toContain("document.body.classList.add('material-transfer-printing')")
    expect(printSource).toContain('body.material-transfer-printing > :not(.material-transfer-print-sheet)')
    expect(printSource).toContain('<BarcodeCard')
    expect(printSource).toContain('Code 128')
    expect(printSource).toContain('转出留存联')
    expect(printSource).toContain('接收确认联')
    expect(printSource).not.toMatch(/工单号|产品|工艺|报工/)
  })
})
