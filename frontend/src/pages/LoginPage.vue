<script setup lang="ts">
import { Lock, User } from '@element-plus/icons-vue'
import { ElButton, ElForm, ElFormItem, ElIcon, ElInput } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authState, currentUser, isAuthenticated, login } from '@/stores/auth'
import { defaultAuthenticatedPath, safeInternalRedirect } from '@/utils/navigation'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const validationMessage = ref('')
const errorMessage = computed(() => validationMessage.value || authState.error)

function safeRedirect(): string {
  return safeInternalRedirect(route.query.redirect, defaultAuthenticatedPath(currentUser.value))
}

async function handleSubmit(): Promise<void> {
  validationMessage.value = ''
  if (!username.value.trim()) {
    validationMessage.value = '请输入登录账号'
    return
  }
  if (!password.value) {
    validationMessage.value = '请输入登录密码'
    return
  }
  try {
    await login({ username: username.value.trim(), password: password.value })
    await router.replace(safeRedirect())
  } catch {
    // 登录状态统一由 store 返回。
  }
}

onMounted(() => {
  if (isAuthenticated.value) void router.replace(safeRedirect())
})
</script>

<template>
  <main class="login-page">
    <section class="login-brand" aria-label="系统名称">
      <span class="login-brand__mark"><img src="/brand/attl-official-logo.png" alt="中国钢研 安泰科技 · 安泰天龙" width="1017" height="143" /></span>
      <h1>热沉物料流转管理系统</h1>
      <p>物料收发 · 批次查询 · 流水号追踪</p>
    </section>

    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-card">
        <header>
          <h2 id="login-title">系统登录</h2>
        </header>

        <ElForm label-position="top" @submit.prevent="handleSubmit">
          <ElFormItem label="登录账号">
            <ElInput
              v-model="username"
              name="username"
              autocomplete="username"
              autocapitalize="none"
              :disabled="authState.loading"
              placeholder="请输入账号"
              size="large"
              autofocus
            >
              <template #prefix><ElIcon><User /></ElIcon></template>
            </ElInput>
          </ElFormItem>

          <ElFormItem label="登录密码" :error="errorMessage">
            <ElInput
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              :disabled="authState.loading"
              placeholder="请输入密码"
              size="large"
              show-password
              @keyup.enter="handleSubmit"
            >
              <template #prefix><ElIcon><Lock /></ElIcon></template>
            </ElInput>
          </ElFormItem>

          <ElButton class="login-submit" type="primary" size="large" native-type="submit" :loading="authState.loading">
            {{ authState.loading ? '正在登录' : '登录' }}
          </ElButton>
        </ElForm>

      </div>
    </section>
  </main>
</template>

<style scoped src="../styles/auth.css"></style>
