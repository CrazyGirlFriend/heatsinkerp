<script setup lang="ts">
import { Hide, Lock, Right, User, View } from '@element-plus/icons-vue'
import { ElButton, ElForm, ElFormItem, ElIcon, ElInput } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authState, isAuthenticated, login } from '@/stores/auth'
import { DEFAULT_LOGIN_PATH, safeInternalRedirect } from '@/utils/navigation'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const passwordVisible = ref(false)
const submitting = ref(false)
const busy = computed(() => submitting.value || authState.loading)
const validationMessage = ref('')
const navigationFailed = ref(false)
const needsRefresh = computed(() => navigationFailed.value && isAuthenticated.value)
const errorMessage = computed(() =>
  needsRefresh.value
    ? '登录成功，页面加载失败，请刷新并进入'
    : validationMessage.value || authState.error,
)
const refreshHref = computed(
  () => router.resolve({ path: '/login', query: { redirect: safeRedirect() } }).href,
)

function safeRedirect(): string {
  return safeInternalRedirect(route.query.redirect, DEFAULT_LOGIN_PATH)
}

async function enterWorkspace(animate = false): Promise<void> {
  submitting.value = true
  navigationFailed.value = false
  const destination = safeRedirect()
  const navigate = async () => {
    const failure = await router.replace(destination)
    if (failure) throw failure
  }
  try {
    if (
      animate &&
      document.startViewTransition &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const transition = document.startViewTransition(navigate)
      // A failed route rejects all three promises; only the callback decides recovery.
      void transition.ready.catch(() => undefined)
      void transition.finished.catch(() => undefined)
      await transition.updateCallbackDone
    } else {
      await navigate()
    }
  } catch {
    // Keep the valid session; a document reload can fetch the latest release's chunks.
    navigationFailed.value = true
  } finally {
    submitting.value = false
  }
}

async function handleSubmit(): Promise<void> {
  if (busy.value) return
  if (isAuthenticated.value) {
    await enterWorkspace()
    return
  }
  validationMessage.value = ''
  if (!username.value.trim()) {
    validationMessage.value = '请输入登录账号'
    return
  }
  if (!password.value) {
    validationMessage.value = '请输入登录密码'
    return
  }
  submitting.value = true
  try {
    await login({ username: username.value.trim(), password: password.value })
    await enterWorkspace(true)
  } catch {
    // 登录状态统一由 store 返回。
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (isAuthenticated.value) void enterWorkspace()
})
</script>

<template>
  <main class="login-page">
    <img
      class="login-scene"
      src="/images/login-metal-background.webp"
      alt=""
      fetchpriority="high"
      width="1584"
      height="993"
    />
    <section class="login-brand" aria-label="系统名称">
      <span class="login-brand__mark"
        ><img
          src="/brand/attl-official-logo.png"
          alt="中国钢研 安泰科技 · 安泰天龙"
          width="1017"
          height="143"
      /></span>
      <h1><span>热沉事业部</span><span>综合管理系统</span></h1>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-card">
        <header>
          <h2 id="login-title">系统登录</h2>
        </header>

        <ElForm label-position="top" :aria-busy="busy" @submit.prevent="handleSubmit">
          <ElFormItem label="账号" for="login-username">
            <ElInput
              id="login-username"
              v-model="username"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              :disabled="busy || needsRefresh"
              placeholder="请输入账号"
              size="large"
              autofocus
            >
              <template #prefix
                ><ElIcon><User /></ElIcon
              ></template>
            </ElInput>
          </ElFormItem>

          <ElFormItem label="密码" for="login-password">
            <ElInput
              id="login-password"
              v-model="password"
              :type="passwordVisible ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              :disabled="busy || needsRefresh"
              :aria-describedby="errorMessage ? 'login-error' : undefined"
              placeholder="请输入密码"
              size="large"
            >
              <template #prefix
                ><ElIcon><Lock /></ElIcon
              ></template>
              <template #suffix>
                <button
                  class="login-password-toggle"
                  type="button"
                  :disabled="busy || needsRefresh"
                  :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
                  :aria-pressed="passwordVisible"
                  @click="passwordVisible = !passwordVisible"
                >
                  <ElIcon><Hide v-if="passwordVisible" /><View v-else /></ElIcon>
                </button>
              </template>
            </ElInput>
            <p v-if="errorMessage" id="login-error" class="login-error" role="alert">
              {{ errorMessage }}
            </p>
          </ElFormItem>

          <ElButton
            v-if="needsRefresh"
            tag="a"
            :href="refreshHref"
            class="login-submit"
            type="primary"
            size="large"
            >刷新并进入</ElButton
          >
          <ElButton
            v-else
            class="login-submit"
            type="primary"
            size="large"
            native-type="submit"
            :loading="busy"
            :disabled="busy || needsRefresh"
          >
            {{ busy ? '正在登录' : '登录' }}
            <ElIcon v-if="!busy" class="login-submit__arrow" aria-hidden="true"><Right /></ElIcon>
          </ElButton>
        </ElForm>
      </div>
    </section>
  </main>
</template>

<style scoped src="../styles/auth.css"></style>
