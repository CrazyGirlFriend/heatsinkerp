import { describe, expect, it } from 'vitest'
import drawerSource from './MaterialTransferDrawer.vue?raw'
import formSource from './MaterialTransferFormDialog.vue?raw'
import printSource from './MaterialTransferPrintSheet.vue?raw'
import printCopySource from './MaterialTransferPrintCopy.vue?raw'
import printModelSource from '@/utils/materialTransferPrint.ts?raw'
import listSource from '@/pages/TransferBatchesPage.vue?raw'
import serialSource from '@/pages/SerialInventoryPage.vue?raw'

describe('pure material transfer interface', () => {
  it('collects document snapshots without introducing a work-order or process workflow', () => {
    expect(formSource).toContain('接收班组')
    expect(formSource).toContain('流水号')
    expect(formSource).toContain('转料件数')
    expect(formSource).toContain('转料重量')
    expect(formSource).toContain('备注')
    expect(formSource).toContain('物料类型')
    expect(formSource).not.toMatch(/工单号|工艺路线|报工/)
    expect(formSource).toContain('createRequestFingerprint.value !== requestFingerprint')
    expect(formSource).toContain('idempotency_key: createRequestKey.value')
  })

  it('confirms the whole batch without reentry and requires counterparty approval for later changes', () => {
    expect(drawerSource).toContain('整单确认签收')
    expect(drawerSource).toContain('无需重新录入数量或重量')
    expect(drawerSource).toContain('签收后可申请修改，须经对方确认后生效')
    expect(drawerSource).not.toContain('received_quantity')
    expect(drawerSource).not.toContain('received_weight')
    expect(drawerSource).not.toContain('<ElInputNumber')
  })

  it('keeps the transfer list for ordinary queries and provides serial inventory lookup', () => {
    expect(listSource).toContain('class="page workspace-page transfers-page reading-workspace"')
    expect(listSource).toMatch(/<WorkspaceTable\s+v-else\b/)
    expect(listSource).not.toContain('height="100%"')
    expect(listSource).not.toContain('aria-label="扫码查询"')
    expect(serialSource).toContain('aria-label="全厂库存明细"')
    expect(serialSource).toContain('prop="team_name" label="所在班组"')
    for (const source of [listSource, serialSource, drawerSource, formSource]) {
      expect(source).not.toContain("from '@ant-design/icons-vue'")
    }
  })

  it('prints a teleported Code 128 transfer sheet containing only handoff facts', () => {
    expect(drawerSource).toMatch(/<Teleport\s+to="body"\s*>/)
    expect(drawerSource).toContain("document.body.classList.add('material-transfer-printing')")
    expect(printSource).toContain(
      'body.material-transfer-printing > :not(.material-transfer-print-sheet)',
    )
    expect(printSource).toContain('<MaterialTransferPrintDocument')
    expect(printCopySource).toContain('<BarcodeCard')
    expect(printModelSource).toContain('转出留存联')
    expect(printModelSource).toContain('接收确认联')
    expect(printSource).not.toMatch(/工单号|产品|工艺|报工/)
  })
})
