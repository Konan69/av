import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { resolve } from 'node:path';
import { workspaceServer } from './web/workspace-server';
import { reviewServer } from './web/review-server';
import { djBridge } from './web/dj-bridge';

export default defineConfig({
  plugins: [
    reviewServer(),
    djBridge(),
    workspaceServer(),
    {name:'nw-wrld-jsx-sources',enforce:'pre',async transform(code,id) {
      if (/\/src\/.*\.js$/.test(id)) return transformWithEsbuild(code,id,{loader:'jsx',jsx:'automatic'});
    }},
    react({include:/\.[jt]sx?$/}),
  ],
  css:{postcss:{plugins:[tailwindcss({config:resolve(__dirname,'tailwind.config.js')}),autoprefixer()]}},
  // One three.js for the shell and the standalone visualizer (the renderer lives outside app/).
  resolve:{dedupe:['three']},
  optimizeDeps:{esbuildOptions:{loader:{'.js':'jsx'}}},
  server:{host:'127.0.0.1',port:5177,strictPort:true,fs:{allow:[resolve(__dirname,'..')]}},
  preview:{host:'127.0.0.1',port:4173,strictPort:true},
  build:{target:'esnext',rollupOptions:{input:{shell:resolve(__dirname,'index.html'),dashboard:resolve(__dirname,'dashboard.html'),projector:resolve(__dirname,'projector.html'),sandbox:resolve(__dirname,'sandbox.html'),visualizer:resolve(__dirname,'visualizer.html')}}},
});
