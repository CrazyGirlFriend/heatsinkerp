// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { usePagedRecords } from './usePagedRecords'

type Page = { items: { id: number }[]; total: number; pending_count: number }
const firstPage: Page = { items: [{ id: 1 }], total: 1, pending_count: 1 }
const wrappers: VueWrapper[] = []

function render(
  fetchPage: (pagination: { page: number; page_size: number }) => Promise<Page>,
  clearOnError = false,
) {
  let records!: ReturnType<typeof usePagedRecords<Page>>
  const wrapper = mount(
    defineComponent({
      setup() {
        records = usePagedRecords(fetchPage, { errorMessage: '读取失败', clearOnError })
        return () => null
      },
    }),
  )
  wrappers.push(wrapper)
  return { records, wrapper }
}

function deferred() {
  let resolve!: (page: Page) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Page>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

it('keeps the latest rows and counters when an older request finishes later', async () => {
  const old = deferred()
  const fetchPage = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(firstPage)
  const { records } = render(fetchPage)
  const oldLoad = records.load()
  await records.load()
  old.resolve({ items: [{ id: 2 }], total: 30, pending_count: 20 })
  await oldLoad
  expect(records.rows.value).toEqual(firstPage.items)
  expect(records.result.value?.pending_count).toBe(1)
  expect(records.total.value).toBe(1)
  expect(records.loading.value).toBe(false)
})

it.each(['page', 'size'] as const)(
  'clears previous rows immediately when %s changes',
  async (field) => {
    const old = deferred()
    const fetchPage = vi.fn().mockResolvedValueOnce(firstPage).mockReturnValueOnce(old.promise)
    const { records } = render(fetchPage)
    await records.load()
    const oldLoad = records.load()
    records[field].value = 2
    expect(records.rows.value).toEqual([])
    old.reject(new Error('旧请求失败'))
    await oldLoad
    expect(records.error.value).toBe('')
  },
)

it('reloads the last available page when deletion makes the current page empty', async () => {
  const fetchPage = vi
    .fn()
    .mockResolvedValueOnce({ ...firstPage, items: [], total: 11 })
    .mockResolvedValueOnce({ ...firstPage, total: 11 })
  const { records } = render(fetchPage)
  records.page.value = 3
  await records.load()
  expect(fetchPage.mock.calls).toEqual([[{ page: 3, page_size: 10 }], [{ page: 2, page_size: 10 }]])
  expect(records.page.value).toBe(2)
  expect(records.rows.value).toEqual(firstPage.items)
  expect(records.loading.value).toBe(false)
})

it.each([false, true])(
  'preserves the foreground failure policy (clear rows: %s)',
  async (clearOnError) => {
    const fetchPage = vi.fn().mockResolvedValueOnce(firstPage).mockRejectedValueOnce('失败')
    const { records } = render(fetchPage, clearOnError)
    await records.load()
    await records.load()
    expect(records.rows.value).toEqual(clearOnError ? [] : firstPage.items)
    expect(records.error.value).toBe('读取失败')
    expect(records.loading.value).toBe(false)
  },
)

it('retains visible data and propagates background errors to live refresh', async () => {
  const failure = new Error('暂时断线')
  const background = deferred()
  const fetchPage = vi.fn().mockResolvedValueOnce(firstPage).mockReturnValueOnce(background.promise)
  const { records } = render(fetchPage, true)
  await records.load()
  const refresh = records.load(true)
  expect(records.loading.value).toBe(false)
  background.reject(failure)
  await expect(refresh).rejects.toBe(failure)
  expect(records.rows.value).toEqual(firstPage.items)
  expect(records.error.value).toBe('')
})

it.each(['invalidate', 'unmount'] as const)('ignores requests after %s', async (action) => {
  const old = deferred()
  const { records, wrapper } = render(() => old.promise)
  const oldLoad = records.load()
  if (action === 'invalidate') records.invalidate()
  else wrapper.unmount()
  old.resolve(firstPage)
  await oldLoad
  expect(records.rows.value).toEqual([])
  expect(records.result.value).toBeUndefined()
})
