import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { appPinia } from './stores/access'
import 'element-plus/dist/index.css'
import './styles/inventory-fonts.css'
import './styles/base.css'
import './styles/element-theme.css'
import './styles/workspace.css'
import './styles/reading-workspace.css'
import './styles/business-tables.css'

createApp(App).use(appPinia).use(router).mount('#app')
