// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { processRouteApi } from './processRouteApi'
import * as http from './httpClient'
import { routeFixture } from '@/testFixtures/processRoute'
afterEach(() => vi.restoreAllMocks())
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
