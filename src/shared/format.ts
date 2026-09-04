export function relativeTime(iso: string): string {
	if (!iso) return '';
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return '';
	const s = Math.max(0, Math.round((Date.now() - t) / 1000));
	if (s < 60) return 'now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d}d`;
	const mo = Math.round(d / 30);
	if (mo < 12) return `${mo}mo`;
	return `${Math.round(mo / 12)}y`;
}

export function longTime(iso: string): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fileName(path: string): string {
	return path.split('/').pop() ?? path;
}

export function roomOf(path: string): string {
	const i = path.lastIndexOf('/');
	return i < 0 ? '' : path.slice(0, i);
}

export function extOf(path: string): string {
	const name = fileName(path);
	const i = name.lastIndexOf('.');
	return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export type Kind = 'env' | 'key' | 'cert' | 'json' | 'text' | 'binary';

export function kindOf(path: string): Kind {
	const name = fileName(path).toLowerCase();
	const ext = extOf(path);
	if (name === '.env' || name.startsWith('.env.') || ext === 'env' || name.endsWith('.env')) return 'env';
	if (['p8', 'pem', 'key', 'pub', 'ppk'].includes(ext)) return 'key';
	if (['p12', 'pfx', 'cer', 'crt', 'der', 'mobileprovision'].includes(ext)) return 'cert';
	if (ext === 'json') return 'json';
	if (['txt', 'md', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'csv', ''].includes(ext)) return 'text';
	return 'binary';
}

export function iconFor(kind: Kind): string {
	switch (kind) {
		case 'key':
			return 'key';
		case 'cert':
			return 'shield-check';
		case 'json':
			return 'brackets-curly';
		case 'binary':
			return 'file-archive';
		default:
			return 'file-text';
	}
}
