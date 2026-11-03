// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PersonName from './PersonName.vue'

it('keeps one readable name while switching between a preset and a stable name avatar', async () => {
  const first = mount(PersonName, { props: { name: ' 张师傅 ' } })
  const second = mount(PersonName, { props: { name: '张师傅', size: 30 } })
  try {
    expect(first.text()).toBe('张师傅')
    expect(first.get('.account-avatar').attributes('aria-hidden')).toBe('true')
    expect(first.get('[data-initial]').attributes('data-initial')).toBe('张')
    expect(first.get('.account-avatar').element.getAttribute('style')).toContain('22px')
    expect((first.get('.account-avatar').element as HTMLElement).style.background).toBe(
      (second.get('.account-avatar').element as HTMLElement).style.background,
    )
    await first.setProps({ avatarKey: 'portrait-16' })
    expect(first.find('svg').exists()).toBe(true)
    expect(first.find('[data-initial]').exists()).toBe(false)
    await first.setProps({ avatarKey: 'unknown-preset' })
    expect(first.get('[data-initial]').attributes('data-initial')).toBe('张')
  } finally {
    first.unmount()
    second.unmount()
  }
})

it('does not invent a person for empty or unassigned records', async () => {
  const wrapper = mount(PersonName)
  try {
    for (const name of [null, '', '  ', '—', '未登记', '未指定', '待指定']) {
      await wrapper.setProps({ name })
      expect(wrapper.find('.account-avatar').exists()).toBe(false)
    }
  } finally {
    wrapper.unmount()
  }
})
