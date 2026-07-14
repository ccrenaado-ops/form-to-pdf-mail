import { defineConfig } from 'vite';

// base './' = 相対パス配信。Vercel直下でも ai-business-root（4315）配下のサブパスでも
// 同じビルド出力が動くようにするため（phase4-plan §2）
export default defineConfig({
  base: './',
});
