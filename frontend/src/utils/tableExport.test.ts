import { describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { createExportWorkbook, loadExportPages } from './tableExport'

describe('filtered table export', () => {
  it('reads all filtered pages instead of the currently displayed page', async () => {
    const fetchPage = vi.fn(async (page: number, pageSize: number) => ({
      items: Array.from(
        { length: page === 1 ? 100 : 5 },
        (_, index) => (page - 1) * pageSize + index,
      ),
      total: 105,
      page,
      page_size: pageSize,
    }))
    const progress = vi.fn()
    expect(await loadExportPages(fetchPage, new AbortController().signal, progress)).toHaveLength(
      105,
    )
    expect(fetchPage.mock.calls).toEqual([
      [1, 100],
      [2, 100],
    ])
    expect(progress.mock.calls).toEqual([
      [100, 105],
      [105, 105],
    ])
  })
  it('stops before another page when cancelled, and propagates authorization failures', async () => {
    const controller = new AbortController()
    const fetchPage = vi.fn(async () => {
      controller.abort()
      return { items: [1], total: 2, page: 1, page_size: 100 }
    })
    await expect(loadExportPages(fetchPage, controller.signal, vi.fn())).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchPage).toHaveBeenCalledOnce()
    await expect(
      loadExportPages(
        vi.fn().mockRejectedValue(new Error('无权访问')),
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow('无权访问')
  })
  it('rejects a changed or incomplete result rather than downloading partial data', async () => {
    for (const second of [
      { items: [2], total: 3, page: 2, page_size: 100 },
      { items: [], total: 2, page: 2, page_size: 100 },
    ]) {
      const fetchPage = vi
        .fn()
        .mockResolvedValueOnce({ items: [1], total: 2, page: 1, page_size: 100 })
        .mockResolvedValueOnce(second)
      await expect(
        loadExportPages(fetchPage, new AbortController().signal, vi.fn()),
      ).rejects.toThrow(/变化|不完整/)
    }
  })
  it('writes only chosen columns to real XLSX, preserving identifiers, numeric weights and literal text', async () => {
    const blob = await createExportWorkbook(
      [
        { key: 'serial', label: '流水号' },
        { key: 'weight', label: '重量 (kg)' },
        { key: 'note', label: '备注' },
      ],
      [
        { serial: '00001234', weight: 1234.567, note: '=1+1', hidden: '不可导出内容' },
        { serial: 'YS-017', weight: null, note: '<测试>&文字' },
      ],
    )
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']!)
    const strings = Object.entries(files)
      .filter(([path]) => /sheet1.xml|sharedStrings.xml/.test(path))
      .map(([, bytes]) => strFromU8(bytes))
      .join('')
    expect(strings).toContain('00001234')
    expect(strings).toContain('=1+1')
    expect(strings).toContain('&lt;测试&gt;&amp;文字')
    expect(strings).not.toContain('不可导出内容')
    expect(sheet).toContain('<v>1234.567</v>')
    expect(sheet).not.toContain('<f>')
    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('ySplit="1"')
  })
})
