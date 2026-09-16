import { httpRequest, HttpRequestError, type HttpRequestOptions } from './httpClient'
import { normalizeMaterialDispatch } from './teamMaterialApi'
import { isDispatchNumber, type MaterialDispatchDocument } from '@/types/teamMaterials'

export class MaterialDispatchApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); this.name = 'MaterialDispatchApiError' }
}
async function request(code: string, options?: HttpRequestOptions, action = ''): Promise<MaterialDispatchDocument> {
  if (!isDispatchNumber(code)) throw new MaterialDispatchApiError('请输入有效的 CK 出库批次号')
  let raw: unknown
  try { raw = await httpRequest(`/material-dispatches/${encodeURIComponent(code.trim().toUpperCase())}${action}`, options) }
  catch (error) {
    if (!(error instanceof HttpRequestError)) throw error
    const detail = (error.body as { detail?: unknown } | undefined)?.detail
    const fallback: Record<number, string> = { 403: '当前账号不能确认这一批物料', 404: '未找到出库批次', 409: '整批内容已变化，请刷新并重新核对', 422: '确认信息不完整，请重新读取整批单据' }
    throw new MaterialDispatchApiError(typeof detail === 'string' && /[\u4e00-\u9fff]/.test(detail) ? detail : fallback[error.status] || '整批单据请求失败，请重试', error.status)
  }
  const result = normalizeMaterialDispatch(raw)
  if (!result.source_team?.id || !/^[a-f0-9]{64}$/i.test(result.revision || '') || !Array.isArray(result.allowed_actions) || !Number.isInteger(result.line_count) || result.items.length !== result.line_count || !Number.isInteger(result.pending_line_count) || result.pending_line_count !== result.items.filter(item => item.status === 'pending').length || result.barcode_payload !== result.dispatch_no) {
    throw new MaterialDispatchApiError('整批明细不完整，请重新读取后核对或打印')
  }
  return result as MaterialDispatchDocument
}
export const materialDispatchApi = {
  get(code: string) { return request(code, { noCache: true }) },
  confirm(code: string, body: { idempotency_key: string; expected_revision: string }, outbound = false) {
    return request(code, { method: 'POST', body }, outbound ? '/confirm-outbound' : '/confirm')
  },
}
