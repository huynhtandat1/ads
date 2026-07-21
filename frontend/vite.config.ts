import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const noStoreHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev/HMR và vite preview luôn lấy tài nguyên mới; không cần Ctrl+Shift+R.
  server: { port: 5173, open: true, headers: noStoreHeaders },
  preview: { headers: noStoreHeaders },
})
