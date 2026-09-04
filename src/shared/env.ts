export interface EnvLine {
	index: number;
	kind: 'pair' | 'comment' | 'blank' | 'other';
	key: string;
	value: string;
	raw: string;
}

/** Parse KEY=VALUE text. Anything that is not a pair is kept as-is. */
export function parseEnv(text: string): EnvLine[] {
	return text.split(/\r?\n/).map((raw, index) => {
		const line = raw.trim();
		if (!line) return { index, kind: 'blank' as const, key: '', value: '', raw };
		if (line.startsWith('#')) return { index, kind: 'comment' as const, key: '', value: '', raw };
		const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
		if (!m) return { index, kind: 'other' as const, key: '', value: '', raw };
		let value = m[2];
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		return { index, kind: 'pair' as const, key: m[1], value, raw };
	});
}

export function looksLikeEnv(text: string): boolean {
	const lines = parseEnv(text);
	const pairs = lines.filter((l) => l.kind === 'pair').length;
	const meaningful = lines.filter((l) => l.kind === 'pair' || l.kind === 'other').length;
	return pairs > 0 && pairs >= meaningful * 0.6;
}

export function mask(value: string): string {
	const n = Math.min(Math.max(value.length, 8), 40);
	return '•'.repeat(n);
}
