import { httpClient, httpRequest, HttpRequestError } from './httpClient'
import type { ReceiptDocument, ReceiptDocumentKind } from '@/types/warehouseReceiptDocuments'

const extensions = { process: '.docx', drawing: '.pdf', order: '.xlsx' } as const
const labels = { process: '工艺原件', drawing: '图纸', order: '订单表' } as const

export const warehouseReceiptDocumentApi = {
  async upload(teamId: number, kind: ReceiptDocumentKind, file: File): Promise<ReceiptDocument> {
    if (!file.name.toLowerCase().endsWith(extensions[kind]))
      throw new Error(`${labels[kind]}仅支持 ${extensions[kind]} 格式`)
    if (!file.size || file.size > 5 * 1024 * 1024)
      throw new Error(`${labels[kind]}文件须大于 0 且不超过 5 MB`)
    const body = new FormData()
    body.append('kind', kind)
    body.append('file', file)
    try {
      return await httpRequest<ReceiptDocument>(`/teams/${teamId}/receipt-documents`, {
        method: 'POST',
        body,
      })
    } catch (error) {
      if (
        error instanceof HttpRequestError &&
        error.body &&
        typeof error.body === 'object' &&
        'detail' in error.body &&
        typeof error.body.detail === 'string'
      )
        throw new Error(error.body.detail, { cause: error })
      throw error
    }
  },
  detail: (id: number) => httpRequest<ReceiptDocument>(`/receipt-documents/${id}`),
  remove: (id: number) => httpRequest<void>(`/receipt-documents/${id}`, { method: 'DELETE' }),
  forTransfer: (batchNo: string) =>
    httpRequest<{ items: ReceiptDocument[] }>(
      `/material-transfers/${encodeURIComponent(batchNo)}/receipt-documents`,
    ),
  async file(id: number, signal?: AbortSignal, preview = false): Promise<Blob> {
    const response = await httpClient.get(
      `/receipt-documents/${id}/file${preview ? '?preview=true' : ''}`,
      { responseType: 'blob', signal },
    )
    return response.data
  },
  async download(document: ReceiptDocument) {
    const blob = await warehouseReceiptDocumentApi.file(document.id)
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = document.filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
