// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import MainSystemConfigurationPage from './MainSystemConfigurationPage.vue'
import { mainSystemConfigurationApi as api, type MainSystemConfiguration } from '@/services/mainSystemConfigurationApi'
import { authState, clearSession } from '@/stores/auth'
import { materialDocumentTextFields } from '@/types/materialTransfer'

const baseline: MainSystemConfiguration = { enabled:false,base_url:'https://erp.example.test',timeout_seconds:5,
  has_token:true,version:1,source:'database',key_ready:true,allowed_origins:['https://erp.example.test'],
  updated_by:'管理员',updated_at:null,last_test_at:null,last_test_ok:null,last_test_message:null }
let wrapper: VueWrapper | undefined
beforeEach(() => {
  authState.session = { access_token:'test',token_type:'Bearer',user:{id:1,username:'admin',display_name:'管理员',role:'ADMIN',team_id:null,team:null,active:true} }
  vi.spyOn(api,'get').mockResolvedValue({...baseline})
  vi.spyOn(api,'save').mockResolvedValue({...baseline,version:2})
  vi.spyOn(api,'test').mockResolvedValue({ok:true,message:'查询成功',tested_at:'2026-09-15T01:00:00Z',data:{
    serial_no:'A001',revision:'1',updated_at:'2026-09-15T01:00:00Z',active:true,
    document:{...Object.fromEntries(materialDocumentTextFields.map(f=>[f.key, f.key === 'material_name' ? '铜钼' : null])),material_type:null,finished_quantity:null} as never }})
})
afterEach(() => { wrapper?.unmount(); wrapper=undefined; clearSession(); vi.restoreAllMocks() })
async function open() { wrapper=mount(MainSystemConfigurationPage); await flushPromises(); return wrapper }

it('leaves stored token blank and saves replacement without retaining it in the form',async()=>{
  const page=await open()
  const token=page.get('input[aria-label="访问令牌"]')
  expect((token.element as HTMLInputElement).value).toBe('')
  await token.setValue('new-token')
  await page.get('form.el-form').trigger('submit'); await flushPromises()
  expect(api.save).toHaveBeenCalledWith({enabled:false,base_url:baseline.base_url,timeout_seconds:5,token:'new-token',expected_version:1})
  expect((token.element as HTMLInputElement).value).toBe('')
})

it('retains a draft on save conflict and does not test unsaved settings',async()=>{
  const page=await open()
  vi.mocked(api.save).mockRejectedValue(new Error('配置已被更新，请重新加载后再保存'))
  await page.get('input[aria-label="访问令牌"]').setValue('draft-token')
  await page.get('input[aria-label="测试流水号"]').setValue('A001')
  await page.get('form.integration-test').trigger('submit'); await flushPromises()
  expect(api.test).not.toHaveBeenCalled()
  await page.get('form.el-form').trigger('submit'); await flushPromises()
  expect(page.text()).toContain('配置已被更新')
  expect((page.get('input[aria-label="访问令牌"]').element as HTMLInputElement).value).toBe('draft-token')
})

it('tests saved configuration and shows all master fields without inventory calls',async()=>{
  const page=await open()
  await page.get('input[aria-label="测试流水号"]').setValue('A001')
  await page.get('form.integration-test').trigger('submit'); await flushPromises()
  expect(api.test).toHaveBeenCalledWith('A001',1)
  expect(api.save).not.toHaveBeenCalled()
  expect(page.get('table.el-table__body').text()).toContain('铜钼')
  for(const field of materialDocumentTextFields) expect(page.get('table.el-table__body').text()).toContain(field.label)
})

it('hides configuration and discards late results after losing administrator access',async()=>{
  let resolve!: (v: MainSystemConfiguration)=>void
  vi.mocked(api.get).mockReturnValue(new Promise(r=>{resolve=r}))
  wrapper=mount(MainSystemConfigurationPage)
  clearSession(); await flushPromises()
  resolve({...baseline}); await flushPromises()
  expect(wrapper.text()).toContain('仅管理员可访问')
  expect(wrapper.find('input[aria-label="访问令牌"]').exists()).toBe(false)
})
