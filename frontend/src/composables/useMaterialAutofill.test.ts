// @vitest-environment jsdom
import { effectScope, reactive, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useMaterialAutofill } from './useMaterialAutofill'

describe('suggested material metadata', () => {
  it('preserves manual entries, replaces untouched suggestions and clears them on serial change', () => {
    const scope = effectScope()
    scope.run(() => {
      const serial = ref('A'),
        document = reactive({ material_name: '', customer_code: '手填客户' })
      const form = useMaterialAutofill(() => serial.value, document)
      form.select({
        value: 'A',
        source_batch_no: 'TL1',
        details: { material_name: '材料1', customer_code: 'C1' },
      })
      expect(document).toEqual({ material_name: '材料1', customer_code: '手填客户' })
      expect(form.source('material_name')).toBe('TL1')
      form.select({ value: 'A', source_batch_no: 'TL2', details: { material_name: '材料2' } })
      expect(document.material_name).toBe('材料2')
      form.select({
        value: 'A',
        source_batch_no: 'TL-empty',
        details: { material_name: null, customer_code: null },
      })
      expect(document.material_name).toBe('')
      expect(form.source('material_name')).toBe('')
      expect(document.customer_code).toBe('手填客户')
      document.material_name = '手动材质'
      expect(form.source('material_name')).toBe('')
      serial.value = 'B'
      expect(document.material_name).toBe('手动材质')
      document.material_name = ''
      form.select({ value: 'B', source_batch_no: 'TL3', details: { material_name: '材料3' } })
      serial.value = 'C'
      expect(document.material_name).toBe('')
    })
    scope.stop()
  })
})
