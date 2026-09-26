<script setup lang="ts">
import { ArrowRight, Loading, Lock } from '@element-plus/icons-vue'
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { accessState, checkSiteAccess, unlockSite } from '@/stores/access'
import { isAuthenticated } from '@/stores/auth'
import { safeInternalRedirect } from '@/utils/navigation'

const route = useRoute()
const router = useRouter()
const password = ref('')
const expanded = ref(false)
const passwordInput = ref<HTMLInputElement | null>(null)
const lockButton = ref<HTMLButtonElement | null>(null)
const validationMessage = ref('')
const checking = computed(() => ['unknown', 'checking'].includes(accessState.status))
const busy = computed(() => checking.value || accessState.loading)
const errorMessage = computed(() => validationMessage.value || accessState.error)
const lockLabel = computed(() => accessState.status === 'error' ? '重新检查连接' : '解锁访问')

async function continueToApp(): Promise<void> {
  const destination = safeInternalRedirect(route.query.redirect)
  await router.replace(isAuthenticated.value ? destination : { path: '/login', query: { redirect: destination } })
}

async function handleSubmit(): Promise<void> {
  if (busy.value || !expanded.value || accessState.status === 'error') return
  validationMessage.value = ''
  if (!password.value) {
    validationMessage.value = '请输入访问口令'
    passwordInput.value?.focus()
    return
  }
  const unlocked = await unlockSite(password.value)
  password.value = ''
  if (unlocked) {
    await continueToApp()
  } else {
    await nextTick()
    passwordInput.value?.focus()
  }
}

async function openInput(): Promise<void> {
  if (busy.value) return
  validationMessage.value = ''
  if (accessState.status === 'error') {
    if (await checkSiteAccess(true)) {
      await continueToApp()
      return
    }
    if (accessState.status === 'error') return
  }
  expanded.value = true
  await nextTick()
  passwordInput.value?.focus()
}

async function closeInput(): Promise<void> {
  if (busy.value) return
  expanded.value = false
  password.value = ''
  validationMessage.value = ''
  await nextTick()
  lockButton.value?.focus()
}
</script>

<template>
  <main class="access-gate" aria-label="访问验证" :aria-busy="busy">
    <div class="access-gate__content">
      <button
        ref="lockButton"
        class="access-gate__lock"
        type="button"
        :aria-label="lockLabel"
        :title="lockLabel"
        :aria-expanded="expanded"
        :aria-controls="expanded ? 'access-password-form' : undefined"
        :disabled="busy"
        @click="openInput"
      >
        <Lock aria-hidden="true" />
      </button>

      <span v-if="checking" class="access-gate__sr-only" role="status">正在检查访问权限…</span>
      <span v-else-if="accessState.loading" class="access-gate__sr-only" role="status">正在验证…</span>

      <form
        v-if="expanded && accessState.status !== 'error'"
        id="access-password-form"
        class="access-gate__form"
        novalidate
        @submit.prevent="handleSubmit"
        @keydown.esc.prevent.stop="closeInput"
      >
        <input
          ref="passwordInput"
          v-model="password"
          type="password"
          name="site-access-password"
          aria-label="访问口令"
          :aria-invalid="errorMessage ? true : undefined"
          :aria-describedby="errorMessage ? 'access-password-error' : undefined"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          maxlength="256"
          :disabled="busy"
          placeholder="访问口令"
        />
        <button class="access-gate__submit" type="submit" aria-label="确认解锁" title="确认解锁" :disabled="busy">
          <Loading v-if="busy" class="access-gate__spinner" aria-hidden="true" />
          <ArrowRight v-else aria-hidden="true" />
        </button>
      </form>

      <p
        v-if="errorMessage && (expanded || accessState.status === 'error')"
        id="access-password-error"
        class="access-gate__error"
        role="alert"
      >{{ errorMessage }}</p>
    </div>
  </main>
</template>

<style scoped>
.access-gate {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: auto;
  padding: 32px 24px;
  color: var(--muted);
  background: var(--workspace-bg);
}

.access-gate__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(100%, 256px);
  gap: 22px;
}

.access-gate__lock,
.access-gate__submit {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.access-gate__lock { width: 56px; height: 56px; font-size: 32px; }
.access-gate__submit { width: 44px; height: 44px; font-size: 18px; }
.access-gate__lock:hover:not(:disabled),
.access-gate__submit:hover:not(:disabled) { color: var(--text); }
.access-gate__lock:focus-visible,
.access-gate__submit:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
.access-gate__lock:disabled,
.access-gate__submit:disabled { cursor: wait; opacity: 0.5; }

.access-gate__form {
  display: flex;
  align-items: center;
  width: 100%;
  border-bottom: 1px solid var(--line);
}

.access-gate__form:focus-within { border-bottom-color: var(--primary); }
.access-gate__form input {
  flex: 1;
  min-width: 0;
  height: 44px;
  padding: 8px 10px;
  border: 0;
  border-radius: 0;
  outline: 0;
  color: var(--text);
  background: transparent;
  font-size: 16px;
}
.access-gate__form input::placeholder { color: var(--subtle); }
.access-gate__error { margin: 0; color: #b55252; font-size: 13px; line-height: 1.6; text-align: center; }
.access-gate__spinner { animation: access-spin 800ms linear infinite; }
.access-gate__sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes access-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .access-gate__spinner { animation: none; } }
</style>
