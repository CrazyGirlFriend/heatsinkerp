// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { teamMaterialApi } from '@/services/teamMaterialApi'
import type { TeamDirectoryItem } from '@/types/teamBusiness'
import { useInspectionProblems } from './useInspectionProblems'

let wrapper: VueWrapper
function render() {
  const team = ref(8)
  let state!: ReturnType<typeof useInspectionProblems>
  wrapper = mount(
    defineComponent({
      setup() {
        state = useInspectionProblems(() => team.value, '检验问题读取失败')
        return () => null
      },
    }),
  )
  return { state, team }
}
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
})
const active = { id: 11, team_id: 8, name: '划伤', active: true, version: 1 }

it('keeps the current team catalog when the previous team responds late', async () => {
  let resolveOld!: (items: TeamDirectoryItem[]) => void
  const api = vi
    .spyOn(teamMaterialApi, 'inspectionProblems')
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    .mockResolvedValueOnce([active, { ...active, id: 12, active: false }])
  const { state, team } = render()
  const old = state.load()
  team.value = 9
  await state.load()
  resolveOld([{ ...active, id: 13 }])
  await old
  expect(api.mock.calls).toEqual([[8], [9]])
  expect(state.problems.value).toEqual([active])
  expect(state.loading.value).toBe(false)
})

it('recovers the error and loading state after retrying a failed catalog read', async () => {
  vi.spyOn(teamMaterialApi, 'inspectionProblems')
    .mockRejectedValueOnce(new Error('无法连接'))
    .mockResolvedValueOnce([active])
  const { state } = render()
  await state.load()
  expect(state.error.value).toBe('无法连接')
  expect(state.loading.value).toBe(false)
  await state.load()
  expect(state.problems.value).toEqual([active])
  expect(state.error.value).toBe('')
})

it('does not update the catalog after its form is unmounted', async () => {
  let resolve!: (items: TeamDirectoryItem[]) => void
  vi.spyOn(teamMaterialApi, 'inspectionProblems').mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const { state } = render()
  const pending = state.load()
  wrapper.unmount()
  resolve([active])
  await pending
  expect(state.problems.value).toEqual([])
})
