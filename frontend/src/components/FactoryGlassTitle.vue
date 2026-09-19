<script setup lang="ts">
import type { Component } from 'vue'
defineProps<{ icon: Component; detail?: string }>()
</script>
<template>
  <div class="panel-title"><span class="title-icon"><component :is="icon" /></span><h2><slot /></h2><span v-if="detail" class="title-detail">{{ detail }}</span></div>
</template>
