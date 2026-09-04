import type { Plugin } from 'vite';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, basename, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';

interface MelodicStylesOptions {
	attribute?: string;
	sources?: Record<string, string>;
}

interface StoredLink {
	href: string;
	tag: string;
	placeholder: string;
}

interface ResolvedCss {
	text: string;
	sourceType: 'public' | 'root';
}

/**
 * Vite plugin that preserves <link> tags with the melodic-styles attribute,
 * keeping them separate from the CSS bundle while still minifying them.
 */
export function melodicStylesPlugin(options: MelodicStylesOptions = {}): Plugin {
	const attr = options.attribute ?? 'melodic-styles';

	let root: string;
	let outDir: string;
	let publicDir: string | null = null;
	let base = '/';
	let isBuild = false;
	let placeholderIndex = 0;
	const linkOutputMap = new Map<string, string>();
	const outputFiles = new Map<string, string>();
	const placeholderMap = new Map<string, string>();

	const normalizeBase = (basePath: string, fileName: string): string => {
		const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
		return `${normalizedBase}${fileName}`;
	};

	const resolveSourceCss = async (href: string): Promise<ResolvedCss | null> => {
		const tryRead = async (candidate: string, sourceType: ResolvedCss['sourceType']): Promise<ResolvedCss | null> => {
			try {
				const text = await readFile(candidate, 'utf-8');
				return { text, sourceType };
			} catch {
				return null;
			}
		};

		// A configured source is an explicit contract: if it can't be read,
		// fail the build instead of silently falling back to another lookup.
		const configuredSource = options.sources?.[href];
		if (configuredSource) {
			const configured = await tryRead(configuredSource, 'public');
			if (!configured) {
				throw new Error(`[melodic-styles] Configured source for "${href}" could not be read: ${configuredSource}`);
			}
			return configured;
		}

		if (href.startsWith('/')) {
			if (publicDir) {
				const fromPublic = await tryRead(resolve(publicDir, href.slice(1)), 'public');
				if (fromPublic) {
					return fromPublic;
				}
			}

			const fromRoot = await tryRead(resolve(root, href.slice(1)), 'root');
			if (fromRoot) {
				return fromRoot;
			}
		} else {
			const fromRoot = await tryRead(resolve(root, href), 'root');
			if (fromRoot) {
				return fromRoot;
			}
		}

		return null;
	};

	const replacePlaceholdersInDir = async (dir: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				await replacePlaceholdersInDir(fullPath);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith('.html')) {
				continue;
			}

			let html: string;
			try {
				html = await readFile(fullPath, 'utf-8');
			} catch {
				continue;
			}

			for (const [placeholder, tag] of placeholderMap.entries()) {
				html = html.replace(placeholder, tag);
			}

			await writeFile(fullPath, html);
		}
	};

	return {
		name: 'vite-plugin-melodic-styles',

		configResolved(config) {
			root = config.root;
			outDir = config.build.outDir;
			publicDir = config.publicDir.length > 0 ? config.publicDir : null;
			base = config.base ?? '/';
			isBuild = config.command === 'build';
		},

		// In dev, serve configured sources directly (the build-time output
		// for these hrefs is produced by this plugin, so nothing else
		// provides them to the dev server).
		configureServer(server) {
			const sources = options.sources ?? {};
			if (Object.keys(sources).length === 0) {
				return;
			}

			server.middlewares.use((req, res, next) => {
				const url = (req.url ?? '').split('?')[0];
				const source = sources[url];
				if (!source) {
					next();
					return;
				}

				readFile(source, 'utf-8')
					.then((text) => {
						res.setHeader('Content-Type', 'text/css');
						res.end(text);
					})
					.catch((err) => {
						console.error(`[melodic-styles] Failed to read configured source for ${url}:`, err);
						next();
					});
			});
		},

		// Transform HTML to prevent Vite from processing these specific links
		transformIndexHtml: {
			order: 'pre',
			async handler(html) {
				if (!isBuild) return html;
				const linkRegex = /<link\s+[^>]*?href=["']([^"']+)["'][^>]*>/gi;
				let match;
				let result = html;

				while ((match = linkRegex.exec(html)) !== null) {
					const fullTag = match[0];
					const href = match[1];

					if (!fullTag.includes(attr)) {
						continue;
					}

					const cached = linkOutputMap.get(href);
					if (cached) {
						const placeholder = `<!--melodic-styles:${placeholderIndex++}-->`;
						const updatedTag = fullTag.replace(/href=(["']).*?\1/i, `href="${cached}"`);
						placeholderMap.set(placeholder, updatedTag);
						result = result.replace(fullTag, placeholder);
						continue;
					}

					const resolved = await resolveSourceCss(href);
					if (!resolved) {
						console.error(`[melodic-styles] Failed to read source for ${href}`);
						continue;
					}

					try {
						const { code } = await transform(resolved.text, {
							loader: 'css',
							minify: true
						});

						let outputHref: string;
						let outputPath: string;

						const preserveRootPath = resolved.sourceType === 'root' && href.startsWith('/') && !href.startsWith('/src/');

						if (resolved.sourceType === 'public' || preserveRootPath) {
							const assetPath = href.startsWith('/') ? href.slice(1) : href;
							outputHref = normalizeBase(base, assetPath);
							outputPath = resolve(root, outDir, assetPath);
						} else {
							const ext = extname(href) || '.css';
							const name = basename(href, ext);
							const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
							const fileName = `${name}-${hash}${ext}`;
							outputHref = normalizeBase(base, `assets/${fileName}`);
							outputPath = resolve(root, outDir, 'assets', fileName);
						}

						outputFiles.set(outputPath, code);

						linkOutputMap.set(href, outputHref);
						const updatedTag = fullTag.replace(/href=(["']).*?\1/i, `href="${outputHref}"`);
						const placeholder = `<!--melodic-styles:${placeholderIndex++}-->`;
						placeholderMap.set(placeholder, updatedTag);
						result = result.replace(fullTag, placeholder);

					} catch (err) {
						console.error(`[melodic-styles] Failed to process ${href}:`, err);
					}
				}

				return result;
			}
		}
		,
		async closeBundle() {
			if (!isBuild || outputFiles.size === 0) return;

			for (const [outputPath, code] of outputFiles.entries()) {
				await mkdir(dirname(outputPath), { recursive: true });
				await writeFile(outputPath, code);
			}

			const outRoot = resolve(root, outDir);
			await replacePlaceholdersInDir(outRoot);
		}
	};
}
