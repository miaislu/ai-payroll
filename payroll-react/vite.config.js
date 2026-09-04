import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
        configure(proxy) {
          proxy.on('proxyRes', proxyRes => {
            const cookies = proxyRes.headers['set-cookie']
            if (!cookies) return
            proxyRes.headers['set-cookie'] = cookies.map(c => String(c)
              .replace(/;\s*Secure/gi, '')
              .replace(/;\s*Domain=[^;]*/gi, ''))
          })
        }
      }
    }
  },
  preview: { host: '127.0.0.1', port: 5174 }
})
