// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { useProcessRouteView } from './useProcessRouteView'
import { processRouteApi } from '@/services/processRouteApi'
import { reworkRouteFixture } from '@/testFixtures/processRoute'
import { showToast } from '@/stores/toast'

vi.mock('@/stores/toast', () => ({ showToast: vi.fn() }))
let wrapper: VueWrapper
function render() {
  let view!: ReturnType<typeof useProcessRouteView>
  wrapper = mount({
    setup() {
      view = useProcessRouteView()
      return () => null
    },
  })
  return view
}
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})

it('opens the recorded route id and ignores a response after the viewer closes', async () => {
  let finish!: (value: typeof reworkRouteFixture) => void
  vi.spyOn(processRouteApi, 'detail').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const view = render()
  const opening = view.open(27)
  expect(view.loading.value).toBe(true)
  expect(processRouteApi.detail).toHaveBeenCalledWith(27)
  view.close()
  finish(reworkRouteFixture)
  await opening
  expect(view.route.value).toBeNull()
  expect(view.loading.value).toBe(false)
})

it('clears an older preview on failure instead of showing another batch’s instructions', async () => {
  vi.spyOn(processRouteApi, 'detail')
    .mockResolvedValueOnce(reworkRouteFixture)
    .mockRejectedValueOnce(new Error('工艺读取失败'))
  const view = render()
  await view.open(27)
  expect(view.route.value?.id).toBe(27)
  await view.open(28)
  expect(view.route.value).toBeNull()
  expect(showToast).toHaveBeenCalledWith('工艺读取失败', 'error')
})
