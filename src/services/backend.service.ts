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
	/** Sidebar folder order; also remembers folders that hold no secrets yet. */
	folders: string[];
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
	gcmInstall: GcmInstall;
	/** Git author name; with deviceName it forms this device's keeper label. */
	authorName: string;
	chambers: ChamberSummary[];
	current: string | null;
	appVersion: string;
}
/** An account a repository can be created under on a host. */
export interface Owner {
	login: string;
	kind: 'user' | 'org';
}
export interface HostAccount {
	host: string;
	provider: string;
	providerName: string;
	/** Whether Chamber can create repositories on this host at all. */
	supported: boolean;
	connected: boolean;
	login: string | null;
	owners: Owner[];
	/** Why we are not connected, or why the sign-in we found is not enough. */
	note: string | null;
	tokenPage: string | null;
	/** Whether this build has a GitHub OAuth app, so the browser sign-in works. */
	canSignIn: boolean;
	/** We hold a credential the host rejected; offer to clear it. */
	staleCredential: boolean;
}
/** A browser sign-in waiting on the user to approve a code. */
export interface DeviceCode {
	userCode: string;
	verificationUri: string;
	deviceCode: string;
	interval: number;
	expiresIn: number;
}
export interface NewRepo {
	fullName: string;
	sshUrl: string;
	httpsUrl: string;
	htmlUrl: string;
	/** The one to use as this machine's remote (SSH only when a key is loaded). */
	remoteUrl: string;
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
/** How to get Git Credential Manager on this OS. */
export interface GcmInstall {
	platform: 'macos' | 'windows' | 'linux';
	command: string | null;
	url: string;
	note: string;
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
	gcmInstall: GcmInstall;
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
	createChamber(name: string) { return this.call<ChamberSummary>('chamber_create', { name }); }
	attachRemote(chamberId: string, url: string) { return this.call<ChamberSummary>('chamber_attach_remote', { chamberId, url }); }
	joinChamber(url: string, name?: string) { return this.call<ChamberSummary>('chamber_join', { url, name: name ?? null }); }
	selectChamber(id: string) { return this.call<void>('chamber_select', { id }); }
	setFolders(id: string, folders: string[]) { return this.call<void>('chamber_set_folders', { id, folders }); }
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
	hostAccount(host: string, connect = false) { return this.call<HostAccount>('host_account', { host, connect }); }
	createRepo(host: string, owner: string, name: string, isPrivate: boolean) { return this.call<NewRepo>('host_create_repo', { host, owner, name, private: isPrivate }); }
	disconnectHost(host: string) { return this.call<void>('host_disconnect', { host }); }
	signInStart() { return this.call<DeviceCode>('host_sign_in_start'); }
	signInWait(host: string, code: DeviceCode) { return this.call<HostAccount>('host_sign_in_wait', { host, code }); }
	signInCancel() { return this.call<void>('host_sign_in_cancel'); }
	storeHostToken(host: string, token: string) { return this.call<HostAccount>('host_store_token', { host, token }); }
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
const DEMO_GCM: GcmInstall = { platform: 'macos', command: 'brew install --cask git-credential-manager', url: 'https://github.com/git-ecosystem/git-credential-manager/blob/release/docs/install.md#macos', note: 'Needs Homebrew. There is also a .pkg installer on the releases page.' };

class DemoBackend {
	private folders: string[] = [];
	private secrets = new Map<string, string>([
		['foundry/railway.env', 'NODE_ENV=production\nDATABASE_URL=postgres://foundry:s3cret@db.example.internal:5432/foundry\nREDIS_URL=redis://cache.example.internal:6379\nSTRIPE_SECRET_KEY=sk_test_0000000000000000\nAPP_URL=https://foundry.example.com\n'],
		['foundry/stripe.env', 'STRIPE_SECRET_KEY=sk_test_0000000000000000\nSTRIPE_WEBHOOK_SECRET=whsec_000000000000\n'],
		['tokens/npm.txt', 'npm_000000000000000000000000000000000000\n'],
		['notes.txt', 'Rotate the Stripe key before launch.\n'],
	]);
	private sealedAt = new Map<string, string>();
	private recoverySaved = false;
	/** Flipped by a "connect" call so the preview can show both sides of the dialog. */
	private connectedHost = false;

	async call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
		const now = new Date().toISOString();
		switch (cmd) {
			case 'app_status':
				return {
					identityExists: true, publicKey: 'age1demo000000000000000000000000000000000000000000000000000000', recoverySaved: this.recoverySaved,
					deviceName: 'this browser', appVersion: '0.0.0-demo', gitAvailable: true, gcmAvailable: false, gcmInstall: DEMO_GCM, authorName: 'You', current: 'demo',
					chambers: [{ id: 'demo', name: 'Personal', path: '/demo', remote: 'git@github.com:you/secrets.git', createdAt: now, folders: this.folders, hasAccess: true, keepers: 1, sync: { branch: 'main', remote: 'git@github.com:you/secrets.git', ahead: 0, behind: 0, dirty: false, mergeInProgress: false, conflicts: [] } }],
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
			case 'chamber_set_folders':
				this.folders = args.folders as string[];
				return undefined as T;
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
				return { url, host: 'github.com', provider: 'github', providerName: 'GitHub', isSsh, sshUrl: isSsh ? null : 'git@github.com:you/secrets.git', httpsUrl: null, tokenPage: 'https://github.com/settings/personal-access-tokens/new', tokenScope: 'Contents: read and write', tokenUsername: 'x-access-token', sshKeyAvailable: true, credentialCached: false, gcmAvailable: false, tokenStored: false, gcmInstall: DEMO_GCM } as T;
			}
			case 'host_account': {
				if (args.connect) this.connectedHost = true;
				const connected = this.connectedHost;
				return { host: args.host, provider: 'github', providerName: 'GitHub', supported: true, connected, login: connected ? 'you' : null, owners: connected ? [{ login: 'you', kind: 'user' }, { login: 'melodic-dev', kind: 'org' }] : [], note: null, tokenPage: 'https://github.com/settings/tokens/new?scopes=repo', canSignIn: true, staleCredential: false } as T;
			}
			case 'host_sign_in_start': return { userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', deviceCode: 'demo', interval: 1, expiresIn: 900 } as T;
			case 'host_sign_in_wait': case 'host_store_token':
				this.connectedHost = true;
				return this.call<T>('host_account', { host: args.host });
			case 'host_sign_in_cancel': return undefined as T;
			case 'host_create_repo': {
				const full = `${args.owner}/${args.name}`;
				return { fullName: full, sshUrl: `git@github.com:${full}.git`, httpsUrl: `https://github.com/${full}.git`, htmlUrl: `https://github.com/${full}`, remoteUrl: `https://github.com/${full}.git` } as T;
			}
			case 'host_disconnect': this.connectedHost = false; return undefined as T;
			case 'chamber_create': case 'chamber_attach_remote': return undefined as T;
			case 'copy_text': try { await navigator.clipboard.writeText(String(args.text)); } catch { /* browser preview */ } return undefined as T;
			case 'open_url': window.open(String(args.url), '_blank'); return undefined as T;
			case 'pick_files': case 'pick_folder': case 'pick_save_path': return null as T;
			default: return undefined as T;
		}
	}
}
