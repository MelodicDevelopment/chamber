import { MelodicComponent } from '@melodicdev/core/components';
import { Service } from '@melodicdev/core/injection';
import { RouterService } from '@melodicdev/core/routing';
import { ToastService } from '@melodicdev/components';
import { vaultPageTemplate } from './vault-page.template';
import { vaultPageStyles } from './vault-page.styles';
import { BackendService, asAppError, isDesktop, type AppStatus, type ChamberSummary, type Entry, type SecretContent, type SyncStatus, type LogEntry, type Recipient } from '../../services/backend.service';
import { parseEnv, looksLikeEnv, mask, type EnvLine } from '../../shared/env';
import { kindOf, roomOf } from '../../shared/format';

const REVEAL_MS = 30_000;
const CLIPBOARD_MS = 30_000;

@MelodicComponent({
	selector: 'chamber-vault-page',
	template: vaultPageTemplate,
	styles: vaultPageStyles,
})
export class VaultPage {
	@Service(BackendService) readonly backend!: BackendService;
	@Service(RouterService) readonly router!: RouterService;
	@Service(ToastService) private readonly toast!: ToastService;

	status: AppStatus | null = null;
	chambers: ChamberSummary[] = [];
	current: ChamberSummary | null = null;
	entries: Entry[] = [];
	sync: SyncStatus | null = null;
	syncing = false;

	room: string | null = null; // null = all, 'recent', or a room name
	kindFilter: 'all' | 'env' | 'keys' = 'all';
	search = '';
	menuOpen = false;

	selectedPath: string | null = null;
	content: SecretContent | null = null;
	envLines: EnvLine[] | null = null;
	revealed = new Set<number>();
	revealAll = false;
	loading = false;
	viewingRev: string | null = null;
	history: LogEntry[] = [];
	keepers: Recipient[] = [];

	dragging = false;
	dragCount = 0;
	dropRoom = '';

	busy: '' | 'create' | 'keeper' | 'edit' | 'delete' | 'kit' = '';
	newName = '';
	newRemote = '';
	newKeeperKey = '';
	newKeeperLabel = '';
	editText = '';
	kitPassphrase = '';

	private _revealTimers = new Map<number, { until: number; timer: number }>();
	private _tick: number | null = null;
	private _clipTimer: number | null = null;
	private _unlisten: (() => void) | null = null;
	private _pollTimer: number | null = null;

	// ---- derived ------------------------------------------------------------

	get rooms(): { name: string; count: number }[] {
		const m = new Map<string, number>();
		for (const e of this.entries) {
			const r = roomOf(e.path);
			if (r) m.set(r, (m.get(r) ?? 0) + 1);
		}
		return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
	}

	get filtered(): Entry[] {
		const q = this.search.trim().toLowerCase();
		let list = [...this.entries].sort((a, b) => b.sealedAt.localeCompare(a.sealedAt));
		if (this.room === 'recent') list = list.slice(0, 10);
		else if (this.room) list = list.filter((e) => roomOf(e.path) === this.room || roomOf(e.path).startsWith(this.room + '/'));
		if (this.kindFilter === 'env') list = list.filter((e) => kindOf(e.path) === 'env');
		if (this.kindFilter === 'keys') list = list.filter((e) => ['key', 'cert'].includes(kindOf(e.path)));
		if (q) list = list.filter((e) => e.path.toLowerCase().includes(q));
		return list;
	}

	get selectedEntry(): Entry | undefined {
		return this.entries.find((e) => e.path === this.selectedPath);
	}

	get contentKind(): string {
		if (!this.selectedPath) return '';
		const k = kindOf(this.selectedPath);
		if (this.envLines) return `env · ${this.envLines.filter((l) => l.kind === 'pair').length} values`;
		return k === 'text' ? 'text' : k;
	}

	get maskedText(): string {
		const t = this.content?.text ?? '';
		return t.split('\n').map((l) => (l.trim() ? mask(l) : '')).join('\n');
	}

	get initials(): string {
		const n = this.status?.deviceName ?? '';
		return n.split(/[\s-_.]+/).filter(Boolean).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join('') || 'Me';
	}

	shortRemote(url: string): string {
		return url.replace(/^(https?:\/\/|git@|ssh:\/\/)/, '').replace(/\.git$/, '');
	}

	secondsLeft(index: number): number {
		const t = this._revealTimers.get(index);
		return t ? Math.max(0, Math.ceil((t.until - Date.now()) / 1000)) : 0;
	}

	// ---- lifecycle ----------------------------------------------------------

	async onCreate() {
		await this.refresh();
		await this.listenForDrops();
		window.addEventListener('keydown', this._onKey);
		this._pollTimer = window.setInterval(() => this.refreshSync(), 60_000);
	}

	onDestroy() {
		this._unlisten?.();
		window.removeEventListener('keydown', this._onKey);
		if (this._tick) clearInterval(this._tick);
		if (this._pollTimer) clearInterval(this._pollTimer);
		for (const t of this._revealTimers.values()) clearTimeout(t.timer);
	}

	private _onKey = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			(this.root()?.querySelector('.search input') as HTMLInputElement | null)?.focus();
		}
		if (e.key === 'Escape') this.menuOpen = false;
	};

	private root(): ParentNode | null {
		const ref = (this as unknown as { elementRef?: HTMLElement }).elementRef;
		return ref?.shadowRoot ?? ref ?? null;
	}

	openDialog(id: string) {
		this.menuOpen = false;
		(this.root()?.querySelector(`#${id}`) as { open?: () => void } | null)?.open?.();
	}
	closeDialog(id: string) {
		(this.root()?.querySelector(`#${id}`) as { close?: () => void } | null)?.close?.();
	}

	// ---- data ---------------------------------------------------------------

	async refresh() {
		try {
			this.status = await this.backend.status();
			this.chambers = this.status.chambers;
			if (!this.status.identityExists || (this.chambers.length === 0 && !this.status.recoverySaved)) {
				this.router.navigate('/welcome');
				return;
			}
			this.current = this.chambers.find((c) => c.id === this.status!.current) ?? this.chambers[0] ?? null;
			this.sync = this.current?.sync ?? null;
			await this.loadEntries();
		} catch (e) {
			this.toast.error('Could not load', asAppError(e).message);
		}
	}

	async loadEntries() {
		if (!this.current?.hasAccess) {
			this.entries = [];
			return;
		}
		try {
			this.entries = await this.backend.listSecrets(this.current.id);
			if (this.selectedPath && !this.entries.some((e) => e.path === this.selectedPath)) this.clearSelection();
		} catch (e) {
			this.toast.error('Could not list secrets', asAppError(e).message);
		}
	}

	async refreshSync() {
		if (!this.current?.remote || this.syncing) return;
		try {
			this.sync = await this.backend.syncStatus(this.current.id);
			this.current = { ...this.current, sync: this.sync };
		} catch {
			/* offline is fine */
		}
	}

	async select(id: string) {
		this.menuOpen = false;
		if (id === this.current?.id) return;
		await this.backend.selectChamber(id);
		this.clearSelection();
		this.room = null;
		await this.refresh();
	}

	clearSelection() {
		this.selectedPath = null;
		this.content = null;
		this.envLines = null;
		this.viewingRev = null;
		this.history = [];
		this.hideAll();
	}

	async open(path: string, rev?: string) {
		if (!this.current) return;
		this.selectedPath = path;
		this.viewingRev = rev ?? null;
		this.loading = true;
		this.hideAll();
		try {
			this.content = rev ? await this.backend.openSecretAt(this.current.id, path, rev) : await this.backend.openSecret(this.current.id, path);
			this.envLines = this.content.isText && this.content.text && looksLikeEnv(this.content.text) ? parseEnv(this.content.text) : null;
			this.history = await this.backend.history(this.current.id, path).catch(() => []);
		} catch (e) {
			const err = asAppError(e);
			this.content = null;
			this.toast.error(err.kind === 'locked' ? 'Your key cannot open this' : 'Could not open', err.message);
		} finally {
			this.loading = false;
		}
	}

	// ---- reveal + clipboard -----------------------------------------------------

	toggleReveal(index: number) {
		if (this.revealed.has(index)) return this.hide(index);
		const timer = window.setTimeout(() => this.hide(index), REVEAL_MS);
		this._revealTimers.set(index, { until: Date.now() + REVEAL_MS, timer });
		this.revealed = new Set([...this.revealed, index]);
		this.ensureTick();
	}

	hide(index: number) {
		const t = this._revealTimers.get(index);
		if (t) clearTimeout(t.timer);
		this._revealTimers.delete(index);
		const next = new Set(this.revealed);
		next.delete(index);
		this.revealed = next;
	}

	hideAll() {
		for (const t of this._revealTimers.values()) clearTimeout(t.timer);
		this._revealTimers.clear();
		this.revealed = new Set();
		this.revealAll = false;
	}

	revealText() {
		this.revealAll = true;
		const timer = window.setTimeout(() => (this.revealAll = false), REVEAL_MS);
		this._revealTimers.set(-1, { until: Date.now() + REVEAL_MS, timer });
		this.ensureTick();
	}

	private ensureTick() {
		if (this._tick) return;
		this._tick = window.setInterval(() => {
			if (this._revealTimers.size === 0) {
				clearInterval(this._tick!);
				this._tick = null;
				return;
			}
			this.revealed = new Set(this.revealed); // re-render countdowns
		}, 1000);
	}

	async copy(text: string, message: string, sensitive = false) {
		if (!text) return;
		try {
			await this.backend.copyText(text);
			this.toast.success(message);
			if (sensitive) {
				if (this._clipTimer) clearTimeout(this._clipTimer);
				this._clipTimer = window.setTimeout(() => this.backend.clearClipboard().catch(() => undefined), CLIPBOARD_MS);
			}
		} catch (e) {
			this.toast.error('Could not copy', asAppError(e).message);
		}
	}

	// ---- seal / edit / remove ---------------------------------------------------

	private targetRoom(): string | undefined {
		if (this.dropRoom) return this.dropRoom;
		return this.room && this.room !== 'recent' ? this.room : undefined;
	}

	async addFiles() {
		const files = await this.backend.pickFiles();
		if (files?.length) await this.sealPaths(files, this.targetRoom());
	}

	async sealPaths(files: string[], folder?: string) {
		if (!this.current) return;
		try {
			const r = await this.backend.sealFiles(this.current.id, files, folder);
			await this.loadEntries();
			if (r.sealed.length) {
				this.toast.success(`Sealed ${r.sealed.length} file${r.sealed.length === 1 ? '' : 's'}`, folder ? `into ${folder}` : undefined);
				if (r.sealed.length === 1) await this.open(r.sealed[0]);
			}
			if (r.unchanged.length) this.toast.info('Already sealed', `${r.unchanged.length} file${r.unchanged.length === 1 ? ' was' : 's were'} identical to what is in the chamber.`);
			this.refreshSync();
		} catch (e) {
			this.toast.error('Could not seal', asAppError(e).message);
		}
	}

	startEdit() {
		this.editText = this.content?.text ?? '';
		this.openDialog('edit');
	}

	async saveEdit() {
		if (!this.current || !this.selectedPath) return;
		this.busy = 'edit';
		try {
			const changed = await this.backend.sealText(this.current.id, this.selectedPath, this.editText);
			this.closeDialog('edit');
			await this.loadEntries();
			await this.open(this.selectedPath);
			this.toast.success(changed ? 'Sealed a new version' : 'No changes to seal');
			this.refreshSync();
		} catch (e) {
			this.toast.error('Could not seal', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	async remove() {
		if (!this.current || !this.selectedPath) return;
		this.busy = 'delete';
		try {
			await this.backend.removeSecret(this.current.id, this.selectedPath);
			this.closeDialog('delete');
			this.clearSelection();
			await this.loadEntries();
			this.toast.success('Removed from the chamber');
			this.refreshSync();
		} catch (e) {
			this.toast.error('Could not remove', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	async saveDecrypted() {
		if (!this.content || !this.selectedPath) return;
		const path = await this.backend.pickSavePath(this.selectedPath.split('/').pop() ?? 'secret');
		if (!path) return;
		try {
			await this.backend.writeFileBase64(path, this.content.base64);
			this.toast.success('Saved decrypted copy', 'Remember to delete it when you are done.');
		} catch (e) {
			this.toast.error('Could not save', asAppError(e).message);
		}
	}

	async showHistory() {
		if (!this.current || !this.selectedPath) return;
		this.history = await this.backend.history(this.current.id, this.selectedPath).catch(() => []);
		this.openDialog('history');
	}

	async viewRevision(hash: string) {
		this.closeDialog('history');
		if (this.selectedPath) await this.open(this.selectedPath, hash);
	}

	// ---- sync -------------------------------------------------------------------

	async syncNow() {
		if (!this.current) return;
		this.syncing = true;
		try {
			this.sync = await this.backend.syncNow(this.current.id);
			this.status = await this.backend.status();
			this.chambers = this.status.chambers;
			this.current = this.chambers.find((c) => c.id === this.current!.id) ?? this.current;
			await this.loadEntries();
			if (this.selectedPath) await this.open(this.selectedPath);
			this.closeDialog('sync');
			this.toast.success('Up to date');
		} catch (e) {
			const err = asAppError(e);
			if (err.kind === 'conflict') {
				this.sync = await this.backend.syncStatus(this.current.id).catch(() => this.sync);
				this.current = { ...this.current, sync: this.sync };
				this.openDialog('sync');
				this.toast.warning('Changed on two devices', 'Pick which version to keep.');
			} else if (err.kind === 'auth') {
				this.toast.warning('Sign-in needed', 'The host refused. Open Join to connect with a token or browser sign-in.');
			} else {
				this.toast.error('Sync failed', err.message);
			}
		} finally {
			this.syncing = false;
		}
	}

	async resolve(path: string, keep: 'mine' | 'theirs') {
		if (!this.current) return;
		try {
			this.sync = await this.backend.resolve(this.current.id, path, keep);
			this.current = { ...this.current, sync: this.sync };
			await this.loadEntries();
			if (this.selectedPath) await this.open(this.selectedPath);
			if (this.sync.conflicts.length === 0) {
				this.closeDialog('sync');
				this.toast.success('Resolved and synced');
			}
		} catch (e) {
			this.toast.error('Could not resolve', asAppError(e).message);
		}
	}

	// ---- chambers + keepers -----------------------------------------------------

	async createChamber() {
		this.busy = 'create';
		try {
			await this.backend.createChamber(this.newName.trim(), this.newRemote.trim() || undefined);
			this.closeDialog('new-chamber');
			this.newName = this.newRemote = '';
			this.clearSelection();
			await this.refresh();
			this.toast.success('Chamber created');
		} catch (e) {
			this.toast.error('Could not create', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	async forgetChamber() {
		if (!this.current) return;
		await this.backend.forgetChamber(this.current.id);
		this.closeDialog('settings');
		this.clearSelection();
		await this.refresh();
	}

	async showKeepers() {
		if (!this.current) return;
		this.keepers = await this.backend.keepers(this.current.id).catch(() => []);
		this.openDialog('keepers');
	}

	async addKeeper() {
		if (!this.current) return;
		this.busy = 'keeper';
		try {
			this.keepers = await this.backend.addKeeper(this.current.id, this.newKeeperKey.trim(), this.newKeeperLabel.trim() || 'keeper');
			this.newKeeperKey = this.newKeeperLabel = '';
			this.toast.success('Keeper added', 'Every secret was re-encrypted. Sync to let them in.');
			this.refreshSync();
		} catch (e) {
			this.toast.error('Could not add keeper', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	async removeKeeper(k: Recipient) {
		if (!this.current) return;
		try {
			const exposed = await this.backend.removeKeeper(this.current.id, k.publicKey);
			this.keepers = await this.backend.keepers(this.current.id);
			this.toast.warning('Keeper removed', exposed.length ? `They could read ${exposed.length} secret${exposed.length === 1 ? '' : 's'} before. Rotate those credentials.` : undefined);
			this.refreshSync();
		} catch (e) {
			this.toast.error('Could not remove keeper', asAppError(e).message);
		}
	}

	async saveKit() {
		this.busy = 'kit';
		try {
			const path = await this.backend.pickSavePath('chamber-recovery-kit.age');
			if (!path) return;
			await this.backend.exportRecoveryKit(this.kitPassphrase, path);
			await this.backend.markRecoverySaved();
			this.kitPassphrase = '';
			this.status = await this.backend.status();
			this.toast.success('Recovery kit saved');
		} catch (e) {
			this.toast.error('Could not save the kit', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	// ---- drag and drop ------------------------------------------------------------

	private async listenForDrops() {
		if (!isDesktop()) return;
		const { getCurrentWebview } = await import('@tauri-apps/api/webview');
		this._unlisten = await getCurrentWebview().onDragDropEvent((event) => {
			const p = event.payload;
			if (p.type === 'enter') {
				this.dragging = true;
				this.dragCount = p.paths.length;
				this.dropRoom = this.roomAt(p.position.x, p.position.y);
			} else if (p.type === 'over') {
				this.dropRoom = this.roomAt(p.position.x, p.position.y);
			} else if (p.type === 'drop') {
				const room = this.dropRoom || this.targetRoom();
				this.dragging = false;
				this.dropRoom = '';
				if (this.current?.hasAccess) this.sealPaths(p.paths, room);
				else this.toast.warning('This chamber is locked for you', 'Ask a keeper to add your key first.');
			} else {
				this.dragging = false;
				this.dropRoom = '';
			}
		});
	}

	/** Which sidebar room (if any) is under a drag position given in physical pixels. */
	private roomAt(px: number, py: number): string {
		try {
			const dpr = window.devicePixelRatio || 1;
			const root = this.root() as ShadowRoot | null;
			const el = root?.elementFromPoint?.(px / dpr, py / dpr) as HTMLElement | null;
			const item = el?.closest?.('[data-room]') as HTMLElement | null;
			return item?.dataset.room ?? '';
		} catch {
			return '';
		}
	}
}
