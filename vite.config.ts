import { resolve } from 'node:path';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { melodicStylesPlugin } from './vite-plugin-melodic-styles';

// Tauri loads dist/ off disk in the packaged app and proxies to this dev
// server during `tauri dev`. Relative base + fixed port keep both happy.
export default defineConfig({
	plugins: [
		melodicStylesPlugin({
			sources: {
				'/assets/melodic-components.css': resolve(__dirname, 'node_modules/@melodicdev/components/assets/melodic-components.css'),
			},
		}),
		viteStaticCopy({
			// normalizePath: the src is a fast-glob pattern, which wants forward slashes even on Windows.
			targets: [{ src: normalizePath(resolve(__dirname, 'node_modules/@melodicdev/components/assets/fonts')), dest: 'assets' }],
		}),
	],
	base: './',
	clearScreen: false,
	server: { port: 5180, strictPort: true },
	envPrefix: ['VITE_', 'TAURI_ENV_'],
	build: { target: 'es2022' },
});
