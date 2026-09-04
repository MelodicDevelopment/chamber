/**
 * Every call into the native side goes through here. In a plain browser
 * (`npm run dev` outside Tauri) the app degrades to a small in-memory demo
 * so the UI stays previewable.
 */
import { Injectable } from '@melodicdev/core/injection';

export function isDesktop(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface SyncStatus {
	branch: string;
	remote: string | null;
	ahead: number;
	behind: number;
	dirty: boolean;
	mergeInProgress: boolean;
	conflicts: string[];
}
export interface ChamberSummary {
	id: string;
	name: string;
	path: string;
	remote: string | null;
	createdAt: string;
	hasAccess: boolean;
	keepers: number;
	sync: SyncStatus | null;
}
export interface AppStatus {
	identityExists: boolean;
	publicKey: string | null;
	recoverySaved: boolean;
	deviceName: string;
	gitAvailable: boolean;
	gcmAvailable: boolean;
	chambers: ChamberSummary[];
	current: string | null;
}
export interface Entry {
	path: string;
	size: number;
	sealedAt: string;
	sealedBy: string;
	sha256: string;
}
export interface SecretContent {
	path: string;
	isText: boolean;
	text: string | null;
	base64: string;
	size: number;
}
export interface SealResult {
	sealed: string[];
	unchanged: string[];
}
export interface LogEntry {
	hash: string;
	date: string;
	author: string;
	subject: string;
}
export interface Recipient {
	publicKey: string;
	label: string;
}
export interface HostInfo {
	url: string;
	host: string;
	provider: 'github' | 'gitlab' | 'bitbucket' | 'azuredevops' | 'other';
	providerName: string;
	isSsh: boolean;
	sshUrl: string | null;
	httpsUrl: string | null;
	tokenPage: string | null;
	tokenScope: string;
	tokenUsername: string;
	sshKeyAvailable: boolean;
	credentialCached: boolean;
	gcmAvailable: boolean;
	tokenStored: boolean;
}
export interface AppError {
	kind: 'conflict' | 'auth' | 'git' | 'locked' | 'keychain' | 'error';
	message: string;
	paths?: string[];
}

export function asAppError(e: unknown): AppError {
	if (e && typeof e === 'object' && 'kind' in e && 'message' in e) return e as AppError;
	return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
}

@Injectable()
export class BackendService {
	private _invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;
	private readonly _demo = new DemoBackend();

	async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
		if (!isDesktop()) return this._demo.call<T>(cmd, args);
		if (!this._invoke) {
			const core = await import('@tauri-apps/api/core');
			this._invoke = core.invoke;
		}
		return this._invoke<T>(cmd, args);
	}

	// ---- typed surface -----------------------------------------------------
	status() { return this.call<AppStatus>('app_status'); }
	publicKey() { return this.call<string>('identity_public_key'); }
	exportRecoveryKit(passphrase: string, saveTo?: string) { return this.call<string>('recovery_kit_export', { passphrase, saveTo: saveTo ?? null }); }
	importRecoveryKit(kit: string, passphrase: string) { return this.call<string>('recovery_kit_import', { kit, passphrase }); }
	markRecoverySaved() { return this.call<void>('recovery_mark_saved'); }
	createChamber(name: string, remote?: string) { return this.call<ChamberSummary>('chamber_create', { name, remote: remote ?? null }); }
	joinChamber(url: string, name?: string) { return this.call<ChamberSummary>('chamber_join', { url, name: name ?? null }); }
	selectChamber(id: string) { return this.call<void>('chamber_select', { id }); }
	forgetChamber(id: string) { return this.call<void>('chamber_forget', { id }); }
	listSecrets(chamberId: string) { return this.call<Entry[]>('secrets_list', { chamberId }); }
	openSecret(chamberId: string, path: string) { return this.call<SecretContent>('secret_open', { chamberId, path }); }
	openSecretAt(chamberId: string, path: string, rev: string) { return this.call<SecretContent>('secret_open_at', { chamberId, path, rev }); }
	sealFiles(chamberId: string, files: string[], folder?: string) { return this.call<SealResult>('secret_seal_files', { chamberId, files, folder: folder ?? null }); }
	sealText(chamberId: string, path: string, text: string) { return this.call<boolean>('secret_seal_text', { chamberId, path, text }); }
	removeSecret(chamberId: string, path: string) { return this.call<void>('secret_remove', { chamberId, path }); }
	moveSecrets(chamberId: string, moves: { from: string; to: string }[]) { return this.call<number>('secrets_move', { chamberId, moves }); }
	removeSecrets(chamberId: string, paths: string[]) { return this.call<number>('secrets_remove', { chamberId, paths }); }
	history(chamberId: string, path: string) { return this.call<LogEntry[]>('secret_history', { chamberId, path }); }
	syncStatus(chamberId: string) { return this.call<SyncStatus>('sync_status', { chamberId }); }
	syncNow(chamberId: string) { return this.call<SyncStatus>('sync_now', { chamberId }); }
	resolve(chamberId: string, path: string, keep: 'mine' | 'theirs') { return this.call<SyncStatus>('sync_resolve', { chamberId, path, keep }); }
	keepers(chamberId: string) { return this.call<Recipient[]>('keepers_list', { chamberId }); }
	addKeeper(chamberId: string, publicKey: string, label: string) { return this.call<Recipient[]>('keeper_add', { chamberId, publicKey, label }); }
	removeKeeper(chamberId: string, publicKey: string) { return this.call<string[]>('keeper_remove', { chamberId, publicKey }); }
	detectHost(url: string) { return this.call<HostInfo>('auth_detect', { url }); }
	checkAuth(url: string) { return this.call<void>('auth_check', { url }); }
	storeToken(url: string, token: string, username?: string) { return this.call<void>('auth_store_token', { url, token, username: username ?? null }); }
	pickFiles() { return this.call<string[] | null>('pick_files'); }
	pickFolder() { return this.call<string | null>('pick_folder'); }
	pickSavePath(suggested: string) { return this.call<string | null>('pick_save_path', { suggested }); }
	writeFile(path: string, text: string) { return this.call<void>('write_file', { path, text }); }
	writeFileBase64(path: string, base64Data: string) { return this.call<void>('write_file_base64', { path, base64Data }); }
	openUrl(url: string) { return this.call<void>('open_url', { url }); }
	copyText(text: string) { return this.call<void>('copy_text', { text }); }
	clearClipboard() { return this.call<void>('clear_clipboard'); }
}

/** Browser-only stand-in so `npm run dev` shows something. Nothing persists. */
class DemoBackend {
	private secrets = new Map<string, string>([
		['foundry/railway.env', 'NODE_ENV=production\nDATABASE_URL=postgres://foundry:s3cret@db.example.internal:5432/foundry\nREDIS_URL=redis://cache.example.internal:6379\nSTRIPE_SECRET_KEY=sk_test_0000000000000000\nAPP_URL=https://foundry.example.com\n'],
		['foundry/stripe.env', 'STRIPE_SECRET_KEY=sk_test_0000000000000000\nSTRIPE_WEBHOOK_SECRET=whsec_000000000000\n'],
		['tokens/npm.txt', 'npm_000000000000000000000000000000000000\n'],
		['notes.txt', 'Rotate the Stripe key before launch.\n'],
	]);
	private sealedAt = new Map<string, string>();
	private recoverySaved = false;

	async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
		const now = new Date().toISOString();
		switch (cmd) {
			case 'app_status':
				return {
					identityExists: true, publicKey: 'age1demo000000000000000000000000000000000000000000000000000000', recoverySaved: this.recoverySaved,
					deviceName: 'this browser', gitAvailable: true, gcmAvailable: false, current: 'demo',
					chambers: [{ id: 'demo', name: 'Personal', path: '/demo', remote: 'git@github.com:you/secrets.git', createdAt: now, hasAccess: true, keepers: 1, sync: { branch: 'main', remote: 'git@github.com:you/secrets.git', ahead: 0, behind: 0, dirty: false, mergeInProgress: false, conflicts: [] } }],
				} as T;
			case 'identity_public_key': return 'age1demo000000000000000000000000000000000000000000000000000000' as T;
			case 'recovery_kit_export': return '-----BEGIN AGE ENCRYPTED FILE-----\n(demo)\n-----END AGE ENCRYPTED FILE-----\n' as T;
			case 'recovery_mark_saved': this.recoverySaved = true; return undefined as T;
			case 'secrets_list':
				return [...this.secrets.keys()].map((path) => ({ path, size: this.secrets.get(path)!.length + 200, sealedAt: this.sealedAt.get(path) ?? '2026-09-01T12:00:00Z', sealedBy: 'you', sha256: '' })) as T;
			case 'secret_open': {
				const text = this.secrets.get(args.path as string) ?? '';
				return { path: args.path, isText: true, text, base64: btoa(text), size: text.length } as T;
			}
			case 'secret_seal_text': this.secrets.set(args.path as string, args.text as string); this.sealedAt.set(args.path as string, now); return true as T;
			case 'secret_remove': this.secrets.delete(args.path as string); return undefined as T;
			case 'secrets_remove': { let n = 0; for (const p of args.paths as string[]) if (this.secrets.delete(p)) n++; return n as T; }
			case 'secrets_move': {
				const moves = args.moves as { from: string; to: string }[];
				for (const m of moves) {
					const v = this.secrets.get(m.from);
					if (v === undefined || m.from === m.to) continue;
					if (this.secrets.has(m.to)) throw { kind: 'error', message: `${m.to} already exists`, paths: [] };
					this.secrets.delete(m.from); this.secrets.set(m.to, v);
					const at = this.sealedAt.get(m.from); if (at) { this.sealedAt.delete(m.from); this.sealedAt.set(m.to, at); }
				}
				return moves.length as T;
			}
			case 'secret_history': return [{ hash: 'abc1234', date: now, author: 'you', subject: `Seal ${args.path}` }] as T;
			case 'sync_status': case 'sync_now': return { branch: 'main', remote: 'git@github.com:you/secrets.git', ahead: 0, behind: 0, dirty: false, mergeInProgress: false, conflicts: [] } as T;
			case 'keepers_list': return [{ publicKey: 'age1demo000000000000000000000000000000000000000000000000000000', label: 'you (this browser)' }] as T;
			case 'auth_detect': {
				const url = String(args.url ?? '');
				const isSsh = url.startsWith('git@') || url.startsWith('ssh://');
				return { url, host: 'github.com', provider: 'github', providerName: 'GitHub', isSsh, sshUrl: isSsh ? null : 'git@github.com:you/secrets.git', httpsUrl: null, tokenPage: 'https://github.com/settings/personal-access-tokens/new', tokenScope: 'Contents: read and write', tokenUsername: 'x-access-token', sshKeyAvailable: true, credentialCached: false, gcmAvailable: false, tokenStored: false } as T;
			}
			case 'copy_text': try { await navigator.clipboard.writeText(String(args.text)); } catch { /* browser preview */ } return undefined as T;
			case 'open_url': window.open(String(args.url), '_blank'); return undefined as T;
			case 'pick_files': case 'pick_folder': case 'pick_save_path': return null as T;
			default: return undefined as T;
		}
	}
}
