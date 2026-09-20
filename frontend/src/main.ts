import { createApp } from 'vue'
import App from './App.vue'
import { installDiagnostics } from './services/diagnostics'
import router from './router'
import { appPinia } from './stores/access'
import 'element-plus/dist/index.css'
import './styles/inventory-fonts.css'
import './styles/base.css'
import './styles/element-theme.css'
import './styles/workspace.css'
import './styles/reading-workspace.css'
import './styles/business-tables.css'

const app = createApp(App)
const disposeDiagnostics = installDiagnostics(app)
if (import.meta.hot) import.meta.hot.dispose(disposeDiagnostics)
app.use(appPinia).use(router).mount('#app')
