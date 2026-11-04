<script lang="ts">
import { defineComponent, h, mergeProps, ref } from 'vue'
import { ElSelect } from 'element-plus'
import { useWatermelonAppearance } from '@/composables/useWorkspaceAppearance'
export default defineComponent({
  name: 'AppSelect',
  inheritAttrs: false,
  props: { popperClass: String },
  setup(props, { attrs, slots, expose }) {
    const themed = useWatermelonAppearance()
    const select = ref<InstanceType<typeof ElSelect>>()
    expose({ focus: () => select.value?.focus(), blur: () => select.value?.blur() })
    // Preserve the original option slots and their scope.
    return () =>
      h(
        ElSelect,
        mergeProps(attrs, {
          ref: select,
          class: 'app-select',
          popperClass: [props.popperClass, themed.value ? 'wm-scope wm-control-menu' : '']
            .filter(Boolean)
            .join(' '),
        }),
        slots,
      )
  },
})
</script>
