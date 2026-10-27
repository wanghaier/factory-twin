import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 内网离线部署约束：base 用相对路径，产物不依赖 CDN，可直接由本地静态服务器托管
export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    // 引擎体积较大，先把阈值放宽，便于观察真实产物体量
    chunkSizeWarningLimit: 4096,
    // 不要手动 manualChunks：把 @babylonjs/core 强行归到一个包，会把"只有按需加载的
    // glTF 加载器才用到"的核心模块也拖进首屏包（实测首屏从 1.9 MB 涨到 3.7 MB）。
    // 交给打包器按真实依赖自动切分，动态 import 的加载器才会真正按需下载。
  },
})
