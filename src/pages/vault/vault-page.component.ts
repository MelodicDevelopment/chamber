import { MelodicComponent } from '@melodicdev/core/components';
import { Service } from '@melodicdev/core/injection';
import { RouterService } from '@melodicdev/core/routing';
import { ToastService, DialogService } from '@melodicdev/components';
import { vaultPageTemplate } from './vault-page.template';
import { vaultPageStyles } from './vault-page.styles';
import { BackendService, asAppError, isDesktop, type AppStatus, type ChamberSummary, type Entry, type SecretContent, type SyncStatus, type LogEntry, type Recipient } from '../../services/backend.service';
import { parseEnv, looksLikeEnv, mask, type EnvLine } from '../../shared/env';
import { kindOf, roomOf, fileName, normalizeFolder } from '../../shared/format';
import { savedTheme, setTheme, type ThemeMode } from '../../shared/theme';
import { pairingPayload, parsePairing, deviceLabel } from '../../shared/pairing';

type DialogId = Parameters<DialogService['close']>[0];

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
	@Service(DialogService) private readonly dialogs!: DialogService;

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

	/**
	 * Sidebar folder order, saved per chamber in the app config (not in the repo). Also remembers folders
	 * the user created that hold no secrets yet, since git cannot store an empty directory.
	 */
	folders: string[] = [];
	/** In-app drag of a secret row (or a sidebar folder) onto a sidebar folder. */
	moving: string | null = null;
	movingFolder: string | null = null;
	/** Where a dragged folder lands relative to `moveTo`: inside it, or as a sibling before/after it. */
	movePos: 'into' | 'before' | 'after' = 'into';
	/** Parent picked in the New folder dialog ('' = top level). */
	newFolderParent = '';
	/** Right-click / "⋯" menu on a sidebar folder. */
	folderMenu: { name: string; x: number; y: number } | null = null;
	/** Folder the folder dialogs act on (from the menu), falling back to the one open in the list. */
	menuFolder: string | null = null;
	moveTo: string | null = null;
	ghostX = 0;
	ghostY = 0;
	private _dragStart: { x: number; y: number; path: string; kind: 'secret' | 'folder' } | null = null;
	private _didDrag = false;

	busy: '' | 'create' | 'keeper' | 'edit' | 'delete' | 'kit' | 'folder' | 'move' | 'add' = '';
	newName = '';
	addName = '';
	addValue = '';
	folderName = '';
	renameName = '';
	moveTarget = '';
	moveNewFolder = '';
	folderMoveTarget = '';
	newRemote = '';
	newKeeperKey = '';
	newKeeperLabel = '';
	editText = '';
	kitPassphrase = '';
	theme: ThemeMode = savedTheme();
	/** Which divider is being dragged, if any. Widths live on the host as CSS variables and in localStorage. */
	resizing: 'sidebar' | 'list' | null = null;
	private _resize: { kind: 'sidebar' | 'list'; startX: number; startW: number } | null = null;
	/** True while the Scan dialog holds a live camera. */
	scanning = false;

	private _revealTimers = new Map<number, { until: number; timer: number }>();
	private _tick: number | null = null;
	private _clipTimer: number | null = null;
	private _unlisten: (() => void) | null = null;
	private _pollTimer: number | null = null;

	// ---- derived ------------------------------------------------------------

	/**
	 * Every folder (including ancestors of nested ones) with the number of secrets inside it, nested ones included.
	 * Depth-first; siblings follow the user's order in `folders`, with anything unordered alphabetical after.
	 */
	get rooms(): { name: string; label: string; depth: number; count: number }[] {
		const m = new Map<string, number>();
		const touch = (folder: string, n: number) => {
			const segs = folder.split('/');
			for (let i = 1; i <= segs.length; i++) {
				const k = segs.slice(0, i).join('/');
				m.set(k, (m.get(k) ?? 0) + n);
			}
		};
		for (const e of this.entries) {
			const r = roomOf(e.path);
			if (r) touch(r, 1);
		}
		for (const f of this.folders) if (!m.has(f)) touch(f, 0);
		const rank = new Map(this.folders.map((f, i) => [f, i]));
		const children = (parent: string) => [...m.keys()].filter((k) => roomOf(k) === parent).sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b));
		const out: { name: string; label: string; depth: number; count: number }[] = [];
		const walk = (parent: string, depth: number) => {
			for (const name of children(parent)) {
				out.push({ name, label: name.split('/').pop() ?? name, depth, count: m.get(name) ?? 0 });
				walk(name, depth + 1);
			}
		};
		walk('', 0);
		return out;
	}

	/** The folder currently open in the list, or null for All / Recent. */
	get currentFolder(): string | null {
		return this.room && this.room !== 'recent' ? this.room : null;
	}

	/** Secrets inside a folder, nested ones included. */
	entriesIn(folder: string): Entry[] {
		return this.entries.filter((e) => roomOf(e.path) === folder || roomOf(e.path).startsWith(folder + '/'));
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

	/** What this device shows as a QR code: its public key plus the keeper label it asks for. */
	get pairing(): string {
		const s = this.status;
		return s?.publicKey ? pairingPayload(s.publicKey, deviceLabel(s.authorName, s.deviceName)) : '';
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
		this.applyPaneWidths();
		await this.refresh();
		await this.listenForDrops();
		window.addEventListener('keydown', this._onKey);
		this._pollTimer = window.setInterval(() => this.refreshSync(), 60_000);
	}

	onDestroy() {
		this._unlisten?.();
		window.removeEventListener('pointermove', this._onRowMove);
		window.removeEventListener('pointerup', this._onRowUp);
		window.removeEventListener('keydown', this._onKey);
		window.removeEventListener('pointermove', this._onResizeMove);
		window.removeEventListener('pointerup', this._onResizeUp);
		if (this._tick) clearInterval(this._tick);
		if (this._pollTimer) clearInterval(this._pollTimer);
		for (const t of this._revealTimers.values()) clearTimeout(t.timer);
	}

	private _onKey = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			(this.root()?.querySelector('.search input') as HTMLInputElement | null)?.focus();
		}
		if (e.key === 'Escape') {
			this.menuOpen = false;
			this.folderMenu = null;
		}
	};

	private root(): ParentNode | null {
		const ref = (this as unknown as { elementRef?: HTMLElement }).elementRef;
		return ref?.shadowRoot ?? ref ?? null;
	}

	/** Dialogs are `<ml-dialog #name>`; the `#name` attribute is the id the DialogService knows them by. */
	openDialog(id: string) {
		this.menuOpen = false;
		this.dialogs.open(id as DialogId);
	}
	closeDialog(id: string) {
		this.dialogs.close(id as DialogId);
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
			this.folders = this.current?.folders ?? [];
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
		return this.currentFolder ?? undefined;
	}

	/** Add secret: a name and a value typed in, sealed into the open folder. Files are the alternative, not the default. */
	openAdd() {
		this.addName = '';
		this.addValue = '';
		this.openDialog('add');
	}

	get addPath(): string {
		const leaf = normalizeFolder(this.addName);
		if (!leaf) return '';
		return this.currentFolder ? `${this.currentFolder}/${leaf}` : leaf;
	}

	async addSecret() {
		if (!this.current) return;
		const path = this.addPath;
		if (!path) {
			this.toast.error('Give it a name', 'Something like DATABASE_URL or railway.env.');
			return;
		}
		if (this.entries.some((e) => e.path === path)) {
			this.toast.error('That name is taken here', 'Open the existing secret and use Edit instead.');
			return;
		}
		this.busy = 'add';
		try {
			await this.backend.sealText(this.current.id, path, this.addValue);
			this.closeDialog('add');
			await this.loadEntries();
			await this.open(path);
			this.toast.success('Sealed', this.currentFolder ? `into ${this.currentFolder}` : undefined);
			this.addName = this.addValue = '';
			this.refreshSync();
		} catch (e) {
			this.toast.error('Could not seal', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	async addFiles() {
		const files = await this.backend.pickFiles();
		if (!files?.length) return;
		this.closeDialog('add');
		await this.sealPaths(files, this.targetRoom());
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

	/** Keepers → Scan: swap the Keepers dialog for the camera; it comes back with the fields filled in. */
	startScan() {
		this.closeDialog('keepers');
		this.scanning = true;
		this.openDialog('scan');
	}

	/** Fires on the Scan dialog's close, whether a code was read or the user cancelled. */
	stopScan() {
		if (!this.scanning) return;
		this.scanning = false;
		this.openDialog('keepers');
	}

	onScan(text: string) {
		const p = parsePairing(text);
		if (!p) {
			this.toast.error('That code is not a Chamber key', 'Expected an age1… public key. Try again, or paste the key.');
		} else {
			this.newKeeperKey = p.publicKey;
			this.newKeeperLabel = p.label;
			this.toast.success('Device scanned', `${p.label || 'Its key'} is filled in. Add and rekey when ready.`);
		}
		this.closeDialog('scan');
	}

	pickTheme(mode: ThemeMode) {
		this.theme = mode;
		setTheme(mode);
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

	// ---- folders ------------------------------------------------------------------

	/** Folder the folder dialogs act on. */
	get targetFolder(): string | null {
		return this.menuFolder ?? this.currentFolder;
	}

	/** Save the folder order (and empty folders) for this chamber. Fire and forget; the UI already reflects it. */
	private saveFolders(list: string[]) {
		const next = [...new Set(list)];
		this.folders = next;
		if (this.current) {
			this.current = { ...this.current, folders: next };
			this.backend.setFolders(this.current.id, next).catch(() => undefined);
		}
	}

	/** Put `folder` among the children of `parent` next to `anchor` (a sibling), and remember the whole sidebar order. */
	private placeFolder(folder: string, parent: string, anchor: string, pos: 'before' | 'after') {
		const order = this.rooms.map((r) => r.name).filter((n) => n !== folder && !n.startsWith(folder + '/'));
		const siblings = order.filter((n) => roomOf(n) === parent);
		let i = siblings.indexOf(anchor);
		if (i < 0) i = siblings.length;
		else if (pos === 'after') i += 1;
		siblings.splice(i, 0, folder);
		// Rebuild the flat list: every folder that is not a child of `parent` keeps its place, the siblings take the new order.
		const others = order.filter((n) => roomOf(n) !== parent);
		this.saveFolders([...others, ...siblings]);
	}

	/** Folders a given folder could be moved into: everything except itself and its descendants. */
	folderTargetsFor(folder: string) {
		return this.rooms.filter((r) => r.name !== folder && !r.name.startsWith(folder + '/'));
	}

	openFolderMenu(e: MouseEvent, name: string) {
		e.preventDefault();
		e.stopPropagation();
		this.menuOpen = false;
		this.folderMenu = { name, x: e.clientX, y: e.clientY };
	}

	/** Run a folder action from the context menu. */
	folderAction(action: 'new' | 'rename' | 'move' | 'delete') {
		const name = this.folderMenu?.name ?? null;
		this.folderMenu = null;
		if (!name) return;
		this.menuFolder = name;
		if (action === 'new') {
			this.folderName = '';
			this.newFolderParent = name;
			this.openDialog('new-folder');
		} else if (action === 'rename') {
			this.renameName = name.split('/').pop() ?? name;
			this.openDialog('rename-folder');
		} else if (action === 'move') {
			this.folderMoveTarget = roomOf(name);
			this.openDialog('move-folder');
		} else {
			this.openDialog('delete-folder');
		}
	}

	/** The `+` in the sidebar: suggests the open folder as the parent, but the dialog lets you pick any place. */
	openNewFolder() {
		this.menuFolder = null;
		this.folderName = '';
		this.newFolderParent = this.currentFolder ?? '';
		this.openDialog('new-folder');
	}

	get newFolderPath(): string {
		const leaf = normalizeFolder(this.folderName);
		return leaf && this.newFolderParent ? `${this.newFolderParent}/${leaf}` : leaf;
	}

	createFolder() {
		const name = this.newFolderPath;
		if (!name) {
			this.toast.error('That name will not work', 'Use letters, numbers, dashes.');
			return;
		}
		if (this.rooms.some((r) => r.name === name)) {
			this.toast.error('That folder already exists');
			return;
		}
		// Capture the current sidebar order first so the new folder lands last among its siblings.
		this.saveFolders([...this.rooms.map((r) => r.name), name]);
		this.closeDialog('new-folder');
		this.folderName = '';
		this.menuFolder = null;
		this.room = name;
		this.toast.success('Folder ready', 'Add or drop a secret into it.');
	}

	openRenameFolder() {
		const f = this.currentFolder;
		if (!f) return;
		this.menuFolder = f;
		this.renameName = f.split('/').pop() ?? f;
		this.openDialog('rename-folder');
	}

	/** Rename keeps the folder where it is; only the last path segment changes. */
	async renameFolder() {
		const from = this.targetFolder;
		const leaf = normalizeFolder(this.renameName);
		if (!from || !leaf) {
			this.toast.error('That name will not work', 'Use letters, numbers, dashes.');
			return;
		}
		const parent = roomOf(from);
		const to = parent ? `${parent}/${leaf}` : leaf;
		if (to === from) return this.closeDialog('rename-folder');
		this.busy = 'folder';
		try {
			await this.relocateFolder(from, to, `Renamed to ${leaf}`);
			this.closeDialog('rename-folder');
		} finally {
			this.busy = '';
		}
	}

	/** Move a whole folder into another folder ('' = top level). Resolves to false when the move was refused. */
	async moveFolder(from: string, intoFolder: string): Promise<boolean> {
		if (from === intoFolder || intoFolder.startsWith(from + '/')) {
			this.toast.error('Cannot move a folder into itself');
			return false;
		}
		const leaf = from.split('/').pop() ?? from;
		const to = intoFolder ? `${intoFolder}/${leaf}` : leaf;
		if (to === from) return true;
		if (this.rooms.some((r) => r.name === to)) {
			this.toast.error('A folder with that name is already there', 'Rename one of them first.');
			return false;
		}
		this.busy = 'folder';
		try {
			await this.relocateFolder(from, to, intoFolder ? `Moved into ${intoFolder}` : 'Moved to the top level');
			this.closeDialog('move-folder');
			return true;
		} finally {
			this.busy = '';
		}
	}

	async moveFolderFromDialog() {
		const from = this.targetFolder;
		if (from) await this.moveFolder(from, this.folderMoveTarget);
	}

	/** Shared by rename and move: re-path every secret under `from` in one commit and keep UI state in step. */
	private async relocateFolder(from: string, to: string, message: string) {
		const moves = this.entriesIn(from).map((e) => ({ from: e.path, to: to + e.path.slice(from.length) }));
		if (moves.length) await this.applyMoves(moves, message);
		this.saveFolders(this.rooms.map((r) => r.name).map((f) => (f === from || f.startsWith(from + '/') ? to + f.slice(from.length) : f)));
		if (this.room === from || this.room?.startsWith(from + '/')) this.room = to + this.room.slice(from.length);
		this.menuFolder = null;
	}

	/** Delete the folder, moving its secrets up one level. */
	async dissolveFolder() {
		const from = this.targetFolder;
		if (!from) return;
		const parent = roomOf(from);
		const moves = this.entriesIn(from).map((e) => ({ from: e.path, to: (parent ? parent + '/' : '') + e.path.slice(from.length + 1) }));
		this.busy = 'folder';
		try {
			if (moves.length) await this.applyMoves(moves, parent ? `Moved into ${parent}` : 'Moved to the top level');
			this.forgetFolder(from, parent);
			this.closeDialog('delete-folder');
		} finally {
			this.busy = '';
		}
	}

	/** Delete the folder and every secret in it. */
	async deleteFolderContents() {
		const from = this.targetFolder;
		if (!from || !this.current) return;
		const paths = this.entriesIn(from).map((e) => e.path);
		this.busy = 'folder';
		try {
			if (paths.length) {
				const n = await this.backend.removeSecrets(this.current.id, paths);
				if (this.selectedPath && paths.includes(this.selectedPath)) this.clearSelection();
				await this.loadEntries();
				this.toast.success(`Deleted ${from}`, `${n} secret${n === 1 ? '' : 's'} removed. Rotate them if they were exposed.`);
				this.refreshSync();
			}
			this.forgetFolder(from, roomOf(from));
			this.closeDialog('delete-folder');
		} catch (e) {
			this.toast.error('Could not delete', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	private forgetFolder(from: string, parent: string) {
		this.saveFolders(this.rooms.map((r) => r.name).filter((f) => f !== from && !f.startsWith(from + '/')));
		if (this.room === from || this.room?.startsWith(from + '/')) this.room = parent || null;
		this.menuFolder = null;
	}

	openMove() {
		if (!this.selectedPath) return;
		this.moveTarget = roomOf(this.selectedPath);
		this.moveNewFolder = '';
		this.openDialog('move');
	}

	async moveSelected() {
		if (!this.selectedPath) return;
		const typed = this.moveNewFolder.trim();
		const target = typed ? normalizeFolder(typed) : this.moveTarget;
		if (typed && !target) {
			this.toast.error('That name will not work', 'Use letters, numbers, dashes. Nest with a slash, like team/staging.');
			return;
		}
		this.busy = 'move';
		try {
			await this.moveSecret(this.selectedPath, target);
			this.closeDialog('move');
		} finally {
			this.busy = '';
		}
	}

	/** Move one secret into `folder` ('' = top level), keeping its file name. */
	async moveSecret(path: string, folder: string) {
		const to = (folder ? folder + '/' : '') + fileName(path);
		if (to === path) return;
		await this.applyMoves([{ from: path, to }], folder ? `Moved into ${folder}` : 'Moved to the top level');
	}

	private async applyMoves(moves: { from: string; to: string }[], message: string) {
		if (!this.current) return;
		try {
			const n = await this.backend.moveSecrets(this.current.id, moves);
			const selected = moves.find((m) => m.from === this.selectedPath);
			await this.loadEntries();
			if (selected) await this.open(selected.to);
			this.toast.success(n === 1 ? message : `${message} · ${n} secrets`);
			this.refreshSync();
		} catch (e) {
			this.toast.error('Could not move', asAppError(e).message);
			throw e;
		}
	}

	// ---- in-app drag (secret row -> sidebar folder) ------------------------------------

	rowClick(path: string) {
		if (this._didDrag) {
			this._didDrag = false;
			return;
		}
		this.open(path);
	}

	rowPointerDown(e: PointerEvent, path: string) {
		this.beginDrag(e, path, 'secret');
	}

	folderPointerDown(e: PointerEvent, name: string) {
		if ((e.target as HTMLElement | null)?.closest?.('.more')) return;
		this.beginDrag(e, name, 'folder');
	}

	private beginDrag(e: PointerEvent, path: string, kind: 'secret' | 'folder') {
		if (e.button !== 0 || !this.current?.hasAccess) return;
		this._dragStart = { x: e.clientX, y: e.clientY, path, kind };
		window.addEventListener('pointermove', this._onRowMove);
		window.addEventListener('pointerup', this._onRowUp, { once: true });
	}

	private _onRowMove = (e: PointerEvent) => {
		const st = this._dragStart;
		if (!st) return;
		if (!this.moving && !this.movingFolder) {
			if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
			if (st.kind === 'secret') this.moving = st.path;
			else this.movingFolder = st.path;
			this._didDrag = true;
		}
		this.ghostX = e.clientX;
		this.ghostY = e.clientY;
		const hit = this.folderAtClient(e.clientX, e.clientY);
		// A folder cannot land on itself, inside itself, or next to one of its own children.
		const onSelf = this.movingFolder !== null && hit !== null && (hit.room === this.movingFolder || hit.room.startsWith(this.movingFolder + '/'));
		if (!hit || onSelf) {
			this.moveTo = null;
			this.movePos = 'into';
			return;
		}
		// Dragging a folder: the top and bottom quarter of a folder row mean "put it before/after", the middle means "put it inside".
		let pos: 'into' | 'before' | 'after' = 'into';
		if (this.movingFolder && hit.room !== '') {
			const t = (e.clientY - hit.rect.top) / Math.max(1, hit.rect.height);
			pos = t < 0.25 ? 'before' : t > 0.75 ? 'after' : 'into';
		}
		this.moveTo = hit.room;
		this.movePos = pos;
	};

	private _onRowUp = () => {
		window.removeEventListener('pointermove', this._onRowMove);
		const path = this.moving;
		const folder = this.movingFolder;
		const target = this.moveTo;
		const pos = this.movePos;
		this._dragStart = null;
		this.moving = null;
		this.movingFolder = null;
		this.moveTo = null;
		this.movePos = 'into';
		if (target === null) return;
		if (path && target !== roomOf(path)) this.moveSecret(path, target).catch(() => undefined);
		if (folder) this.dropFolder(folder, target, pos).catch(() => undefined);
	};

	/** Drop a dragged folder: inside `target`, or as a sibling of `target` (reordering, and re-parenting if needed). */
	private async dropFolder(folder: string, target: string, pos: 'into' | 'before' | 'after') {
		if (pos === 'into') {
			if (target !== roomOf(folder)) await this.moveFolder(folder, target);
			return;
		}
		const parent = roomOf(target);
		let moved = folder;
		if (parent !== roomOf(folder)) {
			moved = (parent ? parent + '/' : '') + (folder.split('/').pop() ?? folder);
			if (!(await this.moveFolder(folder, parent))) return;
		}
		this.placeFolder(moved, parent, target, pos);
	}

	/** Click opens a folder; clicking the open folder again goes back to All secrets. */
	folderClick(name: string) {
		if (this._didDrag) {
			this._didDrag = false;
			return;
		}
		this.room = this.room === name ? null : name;
	}

	/** Folder row under a client-space point: room '' for All secrets (top level), null when not over a folder. */
	private folderAtClient(x: number, y: number): { room: string; rect: DOMRect } | null {
		try {
			const root = this.root() as ShadowRoot | null;
			const el = root?.elementFromPoint?.(x, y) as HTMLElement | null;
			const item = el?.closest?.('[data-room]') as HTMLElement | null;
			return item ? { room: item.dataset.room ?? '', rect: item.getBoundingClientRect() } : null;
		} catch {
			return null;
		}
	}

	// ---- resizable panes ------------------------------------------------------------

	private static readonly PANES = {
		sidebar: { key: 'chamber.sidebarWidth', css: '--sidebar-w', def: 248, min: 200, max: 420 },
		list: { key: 'chamber.listWidth', css: '--list-w', def: 372, min: 260, max: 640 },
	} as const;

	private host(): HTMLElement | null {
		return (this as unknown as { elementRef?: HTMLElement }).elementRef ?? null;
	}

	private paneWidth(kind: 'sidebar' | 'list'): number {
		const p = VaultPage.PANES[kind];
		try {
			const v = Number(localStorage.getItem(p.key));
			if (v >= p.min && v <= p.max) return v;
		} catch {
			/* no storage */
		}
		return p.def;
	}

	private setPaneWidth(kind: 'sidebar' | 'list', w: number, persist: boolean) {
		const p = VaultPage.PANES[kind];
		const clamped = Math.round(Math.min(p.max, Math.max(p.min, w)));
		this.host()?.style.setProperty(p.css, `${clamped}px`);
		if (persist) {
			try {
				localStorage.setItem(p.key, String(clamped));
			} catch {
				/* ignore */
			}
		}
		return clamped;
	}

	private applyPaneWidths() {
		this.setPaneWidth('sidebar', this.paneWidth('sidebar'), false);
		this.setPaneWidth('list', this.paneWidth('list'), false);
	}

	startResize(e: PointerEvent, kind: 'sidebar' | 'list') {
		if (e.button !== 0) return;
		e.preventDefault();
		const cur = parseFloat(this.host()?.style.getPropertyValue(VaultPage.PANES[kind].css) || '') || this.paneWidth(kind);
		this._resize = { kind, startX: e.clientX, startW: cur };
		this.resizing = kind;
		this.host()?.classList.add('resizing');
		window.addEventListener('pointermove', this._onResizeMove);
		window.addEventListener('pointerup', this._onResizeUp, { once: true });
	}

	private _onResizeMove = (e: PointerEvent) => {
		const r = this._resize;
		if (!r) return;
		this.setPaneWidth(r.kind, r.startW + (e.clientX - r.startX), false);
	};

	private _onResizeUp = (e: PointerEvent) => {
		window.removeEventListener('pointermove', this._onResizeMove);
		const r = this._resize;
		this._resize = null;
		this.resizing = null;
		this.host()?.classList.remove('resizing');
		if (r) this.setPaneWidth(r.kind, r.startW + (e.clientX - r.startX), true);
	};

	/** Double-click a divider to go back to the default width. */
	resetResize(kind: 'sidebar' | 'list') {
		this.setPaneWidth(kind, VaultPage.PANES[kind].def, true);
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
