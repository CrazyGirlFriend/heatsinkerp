// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { processRouteApi, ProcessRouteSerialConflictError } from './processRouteApi'
import * as http from './httpClient'
import { routeFixture } from '@/testFixtures/processRoute'
afterEach(() => vi.restoreAllMocks())
it('identifies a duplicate normal serial so the form can highlight that field', async () => {
  const failure = new http.HttpRequestError('Conflict', 409, {
    detail: { code: 'duplicate_process_route_serial', message: '流水号“S-001”已有正常工艺' },
  })
  vi.spyOn(http, 'httpRequest').mockRejectedValue(failure)
  await expect(processRouteApi.save(routeFixture)).rejects.toBeInstanceOf(
    ProcessRouteSerialConflictError,
  )
  await expect(processRouteApi.save(routeFixture)).rejects.toMatchObject({
    message: '流水号“S-001”已有正常工艺',
    cause: failure,
  })
})
it('loads both types for the engineering list while keeping warehouse choices normal-only by default', async () => {
  const request = vi.spyOn(http, 'httpRequest').mockResolvedValue({ items: [], total: 0 })
  await processRouteApi.list('', 1, undefined, 'desc', 20, 'all')
  expect(request.mock.calls[0]![0]).toContain('kind=all')
  await processRouteApi.list('', 1, 'published')
  expect(request.mock.calls[1]![0]).not.toContain('kind=all')
  expect(request.mock.calls[1]![0]).toContain('state=published')
})
it('uploads Word as FormData and does not overwrite the retained source in draft writes', async () => {
  const request = vi.spyOn(http, 'httpRequest').mockResolvedValue(routeFixture)
  const file = new File(['word-bytes'], '工艺.docx')
  await processRouteApi.import(file)
  const options = request.mock.calls[0]![1]!
  expect(options.body).toBeInstanceOf(FormData)
  expect((options.body as FormData).get('file')).toBe(file)
  await processRouteApi.save(routeFixture)
  expect(request.mock.calls[1]![1]!.body).toEqual(
    expect.objectContaining({ version: 1, steps: routeFixture.steps }),
  )
  expect(request.mock.calls[1]![1]!.body).not.toHaveProperty('source_data')
})

it.each(['工艺.doc', '工艺.pdf', '工艺.xlsx', '工艺.docx.exe'])(
  'rejects an unsupported %s file before uploading',
  async (filename) => {
    const request = vi.spyOn(http, 'httpRequest').mockResolvedValue(routeFixture)
    await expect(processRouteApi.import(new File(['not-word'], filename))).rejects.toThrow(
      '仅支持 .docx',
    )
    expect(request).not.toHaveBeenCalled()
  },
)

it('rejects files over 5 MB and accepts a case-insensitive extension at the size limit', async () => {
  const request = vi.spyOn(http, 'httpRequest').mockResolvedValue(routeFixture)
  const bytes = new Uint8Array(5 * 1024 * 1024)
  await expect(processRouteApi.import(new File([bytes, 'x'], '过大工艺.docx'))).rejects.toThrow(
    '不能超过 5 MB',
  )
  expect(request).not.toHaveBeenCalled()
  const file = new File([bytes], '工艺.DOCX')
  await processRouteApi.import(file)
  expect(request).toHaveBeenCalledOnce()
  expect((request.mock.calls[0]![1]!.body as FormData).get('file')).toBe(file)
})

it('keeps the server format rejection and its cause for the intake form', async () => {
  const failure = new http.HttpRequestError('Unprocessable Entity', 422, {
    detail: '文档缺少工艺表头，不能导入',
  })
  vi.spyOn(http, 'httpRequest').mockRejectedValue(failure)
  await expect(processRouteApi.import(new File(['fake-word'], '工艺.docx'))).rejects.toMatchObject({
    message: '文档缺少工艺表头，不能导入',
    cause: failure,
  })
})

it.each(['<html><h1>413 Request Entity Too Large</h1></html>', { detail: 'Request too large' }])(
  'explains an upload size rejection without exposing the proxy response',
  async (body) => {
    const failure = new http.HttpRequestError('Request failed with status code 413', 413, body)
    vi.spyOn(http, 'httpRequest').mockRejectedValue(failure)
    await expect(processRouteApi.import(new File(['word'], '工艺.docx'))).rejects.toMatchObject({
      message:
        '工艺单上传被服务器拒绝，请使用不超过 5 MB 的 .docx 文件；若文件符合要求，请联系管理员检查上传限制。',
      cause: failure,
    })
  },
)

it('reads execution-team tasks and purposes through the read-only route endpoint', async () => {
  const data = {
    tasks: [{ id: 4, team_id: 2, name: '精磨', active: true, version: 1 }],
    purposes: [{ id: 3, team_id: 2, name: '产品加工', active: true, version: 1 }],
  }
  const request = vi.spyOn(http, 'httpRequest').mockResolvedValue(data)
  await expect(processRouteApi.options(2)).resolves.toEqual(data)
  expect(request).toHaveBeenCalledWith('/process-routes/options/2', {
    method: 'GET',
    body: undefined,
  })
  expect(request).toHaveBeenCalledOnce()
})
it('creates a manual route without an original and applies version checks to file writes', async () => {
  const request = vi.spyOn(http, 'httpRequest').mockResolvedValue(routeFixture)
  await processRouteApi.save({ ...routeFixture, id: 0, filename: '' })
  expect(request).toHaveBeenLastCalledWith(
    '/process-routes',
    expect.objectContaining({ method: 'POST' }),
  )
  const file = new File(['pdf'], '图纸.pdf')
  await processRouteApi.uploadDrawing(routeFixture, file)
  const upload = request.mock.calls.at(-1)![1]!.body as FormData
  expect(upload.get('version')).toBe('1')
  expect(upload.get('file')).toBe(file)
  await processRouteApi.removeDrawing(routeFixture, 33)
  expect(request).toHaveBeenLastCalledWith('/process-routes/8/drawings/33?version=1', {
    method: 'DELETE',
    body: undefined,
  })
})
it('rejects disguised or oversized drawing names before uploading', async () => {
  const request = vi.spyOn(http, 'httpRequest').mockResolvedValue(routeFixture)
  await expect(
    processRouteApi.uploadDrawing(routeFixture, new File(['x'], '图纸.pdf.exe')),
  ).rejects.toThrow('仅支持 PDF')
  await expect(
    processRouteApi.uploadDrawing(
      routeFixture,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], '大图.pdf'),
    ),
  ).rejects.toThrow('不能超过 5 MB')
  expect(request).not.toHaveBeenCalled()
})

it('passes time sorting and selected page size to the backend list', async () => {
  const request = vi.spyOn(http, 'httpRequest').mockResolvedValue({ items: [], total: 0 })
  await processRouteApi.list('S-001', 3, undefined, 'asc', 50)
  expect(request).toHaveBeenLastCalledWith(
    '/process-routes?query=S-001&page=3&page_size=50&sort_order=asc',
    { method: 'GET', body: undefined },
  )
})
it('separates direction-adjusted drawing previews from original downloads', async () => {
  const blob = new Blob(['pdf'])
  const get = vi.spyOn(http.httpClient, 'get').mockResolvedValue({ data: blob })
  const signal = new AbortController().signal
  await processRouteApi.drawing(8, 33, signal, true)
  expect(get).toHaveBeenLastCalledWith('/process-routes/8/drawings/33?preview=true', {
    responseType: 'blob',
    signal,
  })
  await processRouteApi.drawing(8, 33, signal)
  expect(get).toHaveBeenLastCalledWith('/process-routes/8/drawings/33', {
    responseType: 'blob',
    signal,
  })
  const post = vi.spyOn(http.httpClient, 'post').mockResolvedValue({ data: blob })
  const file = new File(['pdf'], '图纸.pdf')
  await processRouteApi.previewDrawing(file, signal)
  expect(post.mock.calls[0]![0]).toBe('/process-routes/drawing-preview')
  expect((post.mock.calls[0]![1] as FormData).get('file')).toBe(file)
})
