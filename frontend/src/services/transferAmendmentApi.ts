import { httpRequest, HttpRequestError, type HttpRequestOptions } from './httpClient'

export type TransferAmendmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export const transferAmendmentStatusLabels: Record<TransferAmendmentStatus, string> = {
  pending: '待对方确认',
  approved: '已生效',
  rejected: '已拒绝',
  cancelled: '已撤回',
}
export interface TransferAmendmentValues {
  quantity: number
  weight: number
  notes: string | null
}
export interface TransferAmendment {
  id: number
  batch_no: string
  serial_no: string
  status: TransferAmendmentStatus
  reason: string
  requester_team_id: number
  requester_team_name: string
  counterparty_team_id: number
  counterparty_team_name: string
  requested_by: string
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
  response_reason: string | null
  before: TransferAmendmentValues
  after: TransferAmendmentValues
  allowed_actions: ('approve' | 'reject' | 'cancel')[]
}
export interface TransferAmendmentList {
  items: TransferAmendment[]
  remaining_quantity: number
  remaining_weight: number
  editable: boolean
}

async function request<T>(path: string, options: HttpRequestOptions = {}) {
  try {
    return await httpRequest<T>(path, { noCache: true, ...options })
  } catch (error) {
    if (!(error instanceof HttpRequestError)) throw error
    const detail = (error.body as { detail?: unknown } | undefined)?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : error.status === 403
          ? '当前账号无权处理这条修改申请'
          : error.status === 404
            ? '未找到这条修改申请'
            : error.status === 409
              ? '单据或库存已变化，请核对最新内容后重试'
              : error.status === 422
                ? '修改内容不符合要求，请核对后提交'
                : '暂时无法处理修改申请，请重试'
    throw new HttpRequestError(message, error.status, error.body, error.requestId)
  }
}

export const transferAmendmentApi = {
  list: (batchNo: string) =>
    request<TransferAmendmentList>(`/material-transfers/${encodeURIComponent(batchNo)}/amendments`),
  create: (
    batchNo: string,
    payload: TransferAmendmentValues & { expected_version: number; reason: string },
  ) =>
    request<TransferAmendment>(`/material-transfers/${encodeURIComponent(batchNo)}/amendments`, {
      method: 'POST',
      body: payload,
    }),
  get: (id: number) => request<TransferAmendment>(`/transfer-amendments/${id}`),
  approve: (id: number) =>
    request<TransferAmendment>(`/transfer-amendments/${id}/approve`, {
      method: 'POST',
      body: {},
    }),
  reject: (id: number, reason: string) =>
    request<TransferAmendment>(`/transfer-amendments/${id}/reject`, {
      method: 'POST',
      body: { reason },
    }),
  cancel: (id: number) =>
    request<TransferAmendment>(`/transfer-amendments/${id}/cancel`, {
      method: 'POST',
      body: {},
    }),
}
