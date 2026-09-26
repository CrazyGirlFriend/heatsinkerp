<script setup lang="ts">
import { Hide, Lock, Right, User, View } from '@element-plus/icons-vue'
import { ElButton, ElForm, ElFormItem, ElIcon, ElInput } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authState, currentUser, isAuthenticated, login } from '@/stores/auth'
import { defaultAuthenticatedPath, safeInternalRedirect } from '@/utils/navigation'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const passwordVisible = ref(false)
const submitting = ref(false)
const busy = computed(() => submitting.value || authState.loading)
const validationMessage = ref('')
const errorMessage = computed(() => validationMessage.value || authState.error)

function safeRedirect(): string {
  return safeInternalRedirect(route.query.redirect, defaultAuthenticatedPath(currentUser.value))
}

async function handleSubmit(): Promise<void> {
  if (busy.value) return
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
    // Cross-fade only after authentication succeeds; navigation still owns its guards.
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await document.startViewTransition(async () => { await router.replace(safeRedirect()) }).updateCallbackDone
    } else {
      await router.replace(safeRedirect())
    }
  } catch {
    // 登录状态统一由 store 返回。
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (isAuthenticated.value) void router.replace(safeRedirect())
})
</script>

<template>
  <main class="login-page">
    <img class="login-scene" src="/images/login-metal-background.webp" alt="" fetchpriority="high" width="1584" height="993" />
    <section class="login-brand" aria-label="系统名称">
      <span class="login-brand__mark"><img src="/brand/attl-official-logo.png" alt="中国钢研 安泰科技 · 安泰天龙" width="1017" height="143" /></span>
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
              :disabled="busy"
              placeholder="请输入账号"
              size="large"
              autofocus
            >
              <template #prefix><ElIcon><User /></ElIcon></template>
            </ElInput>
          </ElFormItem>

          <ElFormItem label="密码" for="login-password">
            <ElInput
              id="login-password"
              v-model="password"
              :type="passwordVisible ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
              :disabled="busy"
              :aria-describedby="errorMessage ? 'login-error' : undefined"
              placeholder="请输入密码"
              size="large"
            >
              <template #prefix><ElIcon><Lock /></ElIcon></template>
              <template #suffix>
                <button class="login-password-toggle" type="button" :disabled="busy" :aria-label="passwordVisible ? '隐藏密码' : '显示密码'" :aria-pressed="passwordVisible" @click="passwordVisible = !passwordVisible">
                  <ElIcon><Hide v-if="passwordVisible" /><View v-else /></ElIcon>
                </button>
              </template>
            </ElInput>
            <p v-if="errorMessage" id="login-error" class="login-error" role="alert">{{ errorMessage }}</p>
          </ElFormItem>

          <ElButton class="login-submit" type="primary" size="large" native-type="submit" :loading="busy" :disabled="busy">
            {{ busy ? '正在登录' : '登录' }}
            <ElIcon v-if="!busy" class="login-submit__arrow" aria-hidden="true"><Right /></ElIcon>
          </ElButton>
        </ElForm>

      </div>
    </section>
  </main>
</template>

<style scoped src="../styles/auth.css"></style>
