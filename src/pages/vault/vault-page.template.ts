import { html } from '@melodicdev/core/template';
import type { VaultPage } from './vault-page.component';
import { relativeTime, longTime, bytes, fileName, roomOf, kindOf, iconFor } from '../../shared/format';
import { mask } from '../../shared/env';

export function vaultPageTemplate(self: VaultPage) {
	const c = self.current;
	const sync = c?.sync ?? self.sync;
	const pending = sync ? sync.ahead + (sync.dirty ? 1 : 0) : 0;
	const conflicts = sync?.conflicts ?? [];
	const state = !c ? 'off' : !c.remote ? 'off' : conflicts.length || pending || (sync?.behind ?? 0) ? 'pending' : 'ok';
	const stateLabel = !c ? '' : !c.remote ? 'Not synced' : conflicts.length ? `${pending} to sync · ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}` : pending || sync?.behind ? `${pending + (sync?.behind ?? 0)} to sync` : 'Up to date';

	return html`
		<aside>
			<div class="grid"></div>
			<div class="titlebar" data-tauri-drag-region>
				<span class="lockup"><chamber-mark size="16"></chamber-mark><span class="inscr">Chamber</span></span>
			</div>

			<div class="switcher ${self.menuOpen ? 'open' : ''}" @click=${() => (self.menuOpen = !self.menuOpen)}>
				<span class="tile ${c ? '' : 'dim'}">${c ? c.name.charAt(0).toUpperCase() : '?'}</span>
				<div class="grow">
					<div class="name">${c?.name ?? 'No chamber'}</div>
					<div class="repo">${c?.remote ? self.shortRemote(c.remote) : 'Local only'}</div>
				</div>
				<ml-icon icon="caret-down" size="sm"></ml-icon>
			</div>

			${self.menuOpen ? html`
				<div class="scrim" @click=${() => (self.menuOpen = false)}></div>
				<div class="menu">
					<div class="menu-head"><chamber-mark size="18"></chamber-mark><span class="inscr">Your chambers</span></div>
					<div class="menu-list">
						${self.chambers.map((ch) => html`
							<div class="menu-item ${ch.id === c?.id ? 'active' : ''}" @click=${() => self.select(ch.id)}>
								<span class="tile">${ch.name.charAt(0).toUpperCase()}</span>
								<div class="grow"><div class="name">${ch.name}</div><div class="repo">${ch.remote ? self.shortRemote(ch.remote) : 'Local only'}</div></div>
								<span class="state">${!ch.hasAccess ? html`<span class="pulse" style="background: var(--ch-brass); box-shadow: 0 0 0 3px rgba(217,166,82,.22)"></span>Waiting for access` : (ch.sync?.conflicts.length || ch.sync?.ahead || ch.sync?.behind || ch.sync?.dirty) ? html`<span class="pulse pending"></span>To sync` : ch.remote ? html`<span class="pulse ok"></span>Up to date` : html`<span class="pulse off"></span>Local`}</span>
								${ch.id === c?.id ? html`<ml-icon icon="check" size="sm" format="bold" style="color: var(--ch-brass)"></ml-icon>` : ''}
							</div>`)}
					</div>
					<div class="menu-sep"></div>
					<div class="menu-list">
						<div class="menu-action" @click=${() => self.openDialog('new-chamber')}><span class="tile"><ml-icon icon="plus"></ml-icon></span><span class="grow">New chamber</span><span class="state">Fresh repo, your key</span></div>
						<div class="menu-action" @click=${() => self.router.navigate('/join')}><span class="tile"><ml-icon icon="users"></ml-icon></span><span class="grow">Join a chamber</span><span class="state">Someone shares a repo</span></div>
					</div>
				</div>` : ''}

			<nav>
				<div class="nav-item ${self.room === null ? 'active' : ''} ${(self.dropRoom === '' && self.dragging) || ((self.moving || self.movingFolder) && self.moveTo === '') ? 'target' : ''}" data-room="" @click=${() => (self.room = null)}>
					<ml-icon icon="lock" size="sm"></ml-icon><span class="label">All secrets</span><span class="count">${self.entries.length}</span>
				</div>
				<div class="nav-item ${self.room === 'recent' ? 'active' : ''}" @click=${() => (self.room = 'recent')}>
					<ml-icon icon="clock" size="sm"></ml-icon><span class="label">Recently sealed</span>
				</div>
				<div class="nav-head">
					<span class="nav-label inscr">Folders</span>
					${c?.hasAccess ? html`<ml-button variant="ghost" size="xs" title="New folder" @ml:click=${() => self.openNewFolder()}><ml-icon icon="plus" size="xs"></ml-icon></ml-button>` : ''}
				</div>
				${self.rooms.length === 0 ? html`<div class="nav-hint">No folders yet. Make one, or drag a folder from your computer.</div>` : ''}
				${self.rooms.map((r) => html`
					<div class="nav-item folder ${self.room === r.name ? 'active' : ''} ${(self.dragging && self.dropRoom === r.name) || ((self.moving || self.movingFolder) && self.moveTo === r.name && self.movePos === 'into') ? 'target' : ''} ${self.movingFolder && self.moveTo === r.name && self.movePos !== 'into' ? `drop-${self.movePos}` : ''} ${r.count === 0 ? 'pending' : ''} ${self.movingFolder === r.name || (self.movingFolder && r.name.startsWith(self.movingFolder + '/')) ? 'lifting' : ''} ${self.folderMenu?.name === r.name ? 'menu-on' : ''}" style="padding-left: ${12 + r.depth * 14}px" data-room=${r.name} title=${r.name}
						@click=${() => self.folderClick(r.name)} @pointerdown=${(ev: PointerEvent) => self.folderPointerDown(ev, r.name)} @contextmenu=${(ev: MouseEvent) => self.openFolderMenu(ev, r.name)}>
						<ml-icon icon=${self.room === r.name ? 'folder-open' : 'folder'} size="sm"></ml-icon><span class="label">${r.label}</span><span class="count">${r.count}</span>
						<span class="more" title="Folder options" @click=${(ev: MouseEvent) => self.openFolderMenu(ev, r.name)}><ml-icon icon="dots-three" size="sm" format="bold"></ml-icon></span>
					</div>`)}
				<span class="nav-label inscr">Keepers</span>
				<div class="nav-item" @click=${() => self.showKeepers()}><ml-icon icon="users" size="sm"></ml-icon><span class="label">Keepers</span><span class="count">${c?.keepers ?? 0}</span></div>
				<div class="nav-item" @click=${() => self.openDialog('settings')}><ml-icon icon="gear" size="sm"></ml-icon><span class="label">Settings</span></div>
			</nav>

			<div class="user">
				<span class="tile">${self.initials}</span>
				<div class="grow"><div class="name">${self.status?.deviceName ?? ''}</div><div class="meta">${self.chambers.length} chamber${self.chambers.length === 1 ? '' : 's'} · ${self.status?.recoverySaved ? 'kit saved' : 'no recovery kit'}</div></div>
			</div>
		</aside>

		<main>
			<header data-tauri-drag-region>
				<label class="search">
					<ml-icon icon="magnifying-glass" size="sm"></ml-icon>
					<input placeholder="Search this chamber" .value=${self.search} @input=${(e: Event) => (self.search = (e.target as HTMLInputElement).value)} />
					<span class="kbd">⌘K</span>
				</label>
				<span class="grow"></span>
				${c ? html`
					<span class="chip ${state === 'pending' ? 'on' : ''} ${c.remote ? 'btn' : ''}" @click=${() => c.remote && self.openDialog('sync')} title=${c.remote ?? 'No repository connected'}>
						<span class="pulse ${state}"></span>${stateLabel}
					</span>
					<ml-button variant="ghost" size="sm" title="Sync now" ?disabled=${!c.remote || self.syncing} ?loading=${self.syncing} @ml:click=${() => self.syncNow()}><ml-icon icon="arrows-clockwise"></ml-icon></ml-button>
					<ml-button variant="primary" size="sm" ?disabled=${!c.hasAccess} @ml:click=${() => self.openAdd()}><ml-icon slot="icon-start" icon="plus" format="bold"></ml-icon>Add secret</ml-button>
				` : ''}
			</header>

			<section>
				<div class="card">
					${!c ? html`
						<div class="empty grow">
							<chamber-mark size="40"></chamber-mark>
							<div class="big">No chamber yet</div>
							<div>Create one, or join one someone shared with you.</div>
							<div style="display:flex; gap:8px; margin-top:8px">
								<ml-button variant="primary" @ml:click=${() => self.openDialog('new-chamber')}>New chamber</ml-button>
								<ml-button variant="outline" @ml:click=${() => self.router.navigate('/join')}>Join a chamber</ml-button>
							</div>
						</div>` : !c.hasAccess ? html`
						<div class="locked grow">
							<chamber-mark size="48"></chamber-mark>
							<div class="big">Waiting for a keeper to let you in</div>
							<div style="color: var(--ml-color-text-muted); font-size: 13px; max-width: 460px;">This chamber has ${c.keepers} keeper${c.keepers === 1 ? '' : 's'}. Send one of them your public key. Once they add it and sync, this unlocks on its own.</div>
							<div class="key">${self.status?.publicKey ?? ''}</div>
							<div style="display:flex; gap:8px">
								<ml-button variant="primary" size="sm" @ml:click=${() => self.copy(self.status?.publicKey ?? '', 'Public key copied')}><ml-icon slot="icon-start" icon="copy"></ml-icon>Copy public key</ml-button>
								<ml-button variant="outline" size="sm" ?loading=${self.syncing} @ml:click=${() => self.syncNow()}>Check again</ml-button>
							</div>
						</div>` : html`
						<div class="list">
							<div class="list-head">
								<div class="list-head-top">
									<span class="title" title=${self.currentFolder ?? ''}>${self.room === null ? 'All secrets' : self.room === 'recent' ? 'Recently sealed' : self.room}</span>
									${self.currentFolder ? html`<ml-button variant="ghost" size="xs" title="Folder options" @click=${(ev: MouseEvent) => self.openFolderMenu(ev, self.currentFolder!)}><ml-icon icon="dots-three" size="sm" format="bold"></ml-icon></ml-button>` : ''}
								</div>
								<div class="list-head-bar">
									<span class="count">${self.filtered.length} secret${self.filtered.length === 1 ? '' : 's'}</span>
									<span class="grow"></span>
									<div class="filters">
										${(['all', 'env', 'keys'] as const).map((f) => html`<span class="chip btn ${self.kindFilter === f ? 'on' : ''}" @click=${() => (self.kindFilter = f)}>${f === 'all' ? 'All' : f === 'env' ? '.env' : 'Keys'}</span>`)}
									</div>
								</div>
							</div>
							<div class="rows">
								${self.filtered.length === 0 ? html`
									<div class="empty" style="height: 100%">
										<ml-icon icon="tray-arrow-down" size="lg"></ml-icon>
										<div class="big">${self.entries.length === 0 ? 'Nothing sealed yet' : self.currentFolder && self.rooms.find((r) => r.name === self.currentFolder)?.count === 0 ? 'Empty folder' : 'No matches'}</div>
										<div>${self.entries.length === 0 ? 'Drop files anywhere in this window, or use Add secret.' : self.currentFolder && self.rooms.find((r) => r.name === self.currentFolder)?.count === 0 ? 'This folder is empty. Drop a file here, use Add secret, or drag a secret onto it in the sidebar.' : 'Try a different search or folder.'}</div>
									</div>` : ''}
								${self.filtered.map((e) => html`
									<div class="row ${self.selectedPath === e.path ? 'selected' : ''} ${self.moving === e.path ? 'lifting' : ''}" @click=${() => self.rowClick(e.path)} @pointerdown=${(ev: PointerEvent) => self.rowPointerDown(ev, e.path)}>
										<div class="ftile"><ml-icon icon=${iconFor(kindOf(e.path))} size="sm"></ml-icon></div>
										<div class="grow"><div class="name">${fileName(e.path)}</div><div class="meta">${roomOf(e.path) ? roomOf(e.path) + ' · ' : ''}${bytes(e.size)}</div></div>
										${conflicts.includes(`vault/${e.path}.age`) ? html`<span class="chip conflict"><ml-icon icon="warning" size="xs"></ml-icon>Conflict</span><span class="when" style="margin-left:0">${relativeTime(e.sealedAt)}</span>` : html`<span class="when">${relativeTime(e.sealedAt)}</span>`}
									</div>`)}
							</div>
							<div class="list-foot">
								<span>${self.entries.length} secret${self.entries.length === 1 ? '' : 's'} · ${self.rooms.length} folder${self.rooms.length === 1 ? '' : 's'}</span>
								<span style="display:inline-flex; align-items:center; gap:6px"><ml-icon icon="upload-simple" size="xs"></ml-icon>Drop files, or drag to organize</span>
							</div>
						</div>

						<div class="detail">
							${!self.selectedPath ? html`
								<div class="placeholder"><ml-icon icon="lock-key" size="xl"></ml-icon><div>Select a secret to open it here</div></div>` : self.loading ? html`
								<div class="placeholder"><ml-spinner></ml-spinner></div>` : html`
								<div class="detail-head">
									<div class="grow">
										<div class="title">${fileName(self.selectedPath)}</div>
										<div class="tags">
											${roomOf(self.selectedPath) ? html`<span class="chip"><ml-icon icon="folder" size="xs"></ml-icon>${roomOf(self.selectedPath)}</span>` : ''}
											<span class="chip">${self.contentKind}</span>
											<span>${self.selectedEntry ? `Sealed ${longTime(self.selectedEntry.sealedAt)}${self.selectedEntry.sealedBy ? ' by ' + self.selectedEntry.sealedBy : ''}` : ''}${self.viewingRev ? ` · viewing ${self.viewingRev.slice(0, 7)}` : ''}</span>
										</div>
									</div>
									<div class="actions">
										${self.content?.isText ? html`<ml-button variant="outline" size="sm" @ml:click=${() => self.copy(self.content?.text ?? '', 'Copied · clears in 30s', true)}><ml-icon slot="icon-start" icon="copy"></ml-icon>Copy all</ml-button>` : ''}
										<ml-button variant="outline" size="sm" @ml:click=${() => self.saveDecrypted()}><ml-icon slot="icon-start" icon="download-simple"></ml-icon>Save decrypted…</ml-button>
										${self.content?.isText && !self.viewingRev ? html`<ml-button variant="outline" size="sm" @ml:click=${() => self.startEdit()}><ml-icon slot="icon-start" icon="pencil-simple"></ml-icon>Edit</ml-button>` : ''}
										${!self.viewingRev ? html`<ml-button variant="outline" size="sm" title="Move to another folder" @ml:click=${() => self.openMove()}><ml-icon slot="icon-start" icon="folder-simple-plus"></ml-icon>Move…</ml-button>` : ''}
										<ml-button variant="ghost" size="sm" title="Remove from chamber" @ml:click=${() => self.openDialog('delete')}><ml-icon icon="trash"></ml-icon></ml-button>
									</div>
								</div>

								${conflicts.includes(`vault/${self.selectedPath}.age`) ? html`
									<div class="strip"><ml-icon icon="warning" size="sm"></ml-icon><span class="grow">Changed here and on another device. Showing your version.</span><a @click=${() => self.openDialog('sync')}>Resolve</a></div>` : ''}

								<div class="code">
									<div class="code-head">
										<span class="dot" style="background:#c2574a"></span><span class="dot" style="background:#d9a652"></span><span class="dot" style="background:#4fb58a"></span>
										<span style="margin-left: 8px; display:inline-flex; align-items:center; gap:6px"><ml-icon icon="eye" size="xs"></ml-icon>${self.content?.isText ? 'Masked · click a value to reveal it for 30 seconds' : 'Binary file'}</span>
										<span class="path">${self.selectedPath}</span>
									</div>
									<div class="code-body">
										${!self.content?.isText ? html`
											<div class="binary"><ml-icon icon="file-archive" size="xl"></ml-icon><div>${bytes(self.content?.size ?? 0)} · not text, so there is nothing to show here.</div><div>Use Save decrypted to write it to disk.</div></div>` : self.envLines ? html`
											${self.envLines.map((l) => l.kind === 'pair' ? html`
												<div class="ln ${self.revealed.has(l.index) ? 'on' : ''}">
													<span class="n">${l.index + 1}</span><span class="k" title=${l.key}>${l.key}</span><span class="eq">=</span>
													<span class="v" @click=${() => self.toggleReveal(l.index)}>${self.revealed.has(l.index) ? l.value : mask(l.value)}</span>
													${self.revealed.has(l.index) ? html`<span class="chip timer"><ml-icon icon="eye" size="xs"></ml-icon>${self.secondsLeft(l.index)}s</span>` : ''}
													<ml-button variant="ghost" size="xs" title="Copy value" @ml:click=${() => self.copy(l.value, `${l.key} copied · clears in 30s`, true)}><ml-icon icon="copy" size="xs"></ml-icon></ml-button>
												</div>` : l.kind === 'blank' ? html`<div class="ln" style="min-height: 14px"></div>` : html`
												<div class="ln"><span class="n">${l.index + 1}</span><span class="v plain">${l.raw}</span></div>`)}
										` : html`
											<div class="textblock ${self.revealAll ? '' : 'masked'}" @click=${() => (self.revealAll ? null : self.revealText())}>${self.revealAll ? self.content?.text : self.maskedText}</div>`}
									</div>
								</div>

								<div class="detail-foot">
									<span style="display:inline-flex; align-items:center; gap:8px"><ml-icon icon="git-branch" size="xs"></ml-icon>${self.history.length ? `${self.history.length} version${self.history.length === 1 ? '' : 's'} · ` : ''}every change is committed for you</span>
									<span class="links">
										${self.viewingRev ? html`<a @click=${() => self.open(self.selectedPath!)}>Back to current</a>` : ''}
										<a @click=${() => self.showHistory()}>History</a>
									</span>
								</div>`}
						</div>`}
				</div>
			</section>

			${self.dragging ? html`
				<div class="drop"><div class="drop-inner">
					<span class="tile"><ml-icon icon="upload-simple" size="lg"></ml-icon></span>
					<div class="big">Seal it away</div>
					<div class="desc">${self.dragCount ? `${self.dragCount} file${self.dragCount === 1 ? '' : 's'} will be` : 'Files will be'} sealed into <b>${self.dropRoom || (self.room && self.room !== 'recent' ? self.room : 'the chamber')}</b> and committed</div>
					<div class="fine">Drop on a folder in the sidebar to seal it there instead</div>
				</div></div>` : ''}
		</main>

		${self.moving || self.movingFolder ? html`
			<div class="ghost" style="left: ${self.ghostX + 14}px; top: ${self.ghostY + 10}px">
				<ml-icon icon=${self.moving ? iconFor(kindOf(self.moving)) : 'folder'} size="sm"></ml-icon><span>${fileName(self.moving ?? self.movingFolder ?? '')}</span>
				<span class="to">${self.moveTo === null ? (self.movingFolder ? 'Drop between folders to reorder, on one to nest' : 'Drop on a folder') : self.movePos === 'before' ? `↑ before ${fileName(self.moveTo)}` : self.movePos === 'after' ? `↓ after ${fileName(self.moveTo)}` : self.moveTo === '' ? '→ top level' : `→ ${self.moveTo}`}</span>
			</div>` : ''}

		${self.folderMenu ? html`
			<div class="scrim" @click=${() => (self.folderMenu = null)} @contextmenu=${(ev: Event) => { ev.preventDefault(); self.folderMenu = null; }}></div>
			<div class="ctx" style="left: ${Math.min(self.folderMenu.x, window.innerWidth - 230)}px; top: ${Math.min(self.folderMenu.y, window.innerHeight - 190)}px">
				<div class="ctx-title">${self.folderMenu.name}</div>
				<div class="ctx-item" @click=${() => self.folderAction('new')}><ml-icon icon="folder-plus" size="sm"></ml-icon>New folder inside</div>
				<div class="ctx-item" @click=${() => self.folderAction('rename')}><ml-icon icon="pencil-simple" size="sm"></ml-icon>Rename</div>
				<div class="ctx-item" @click=${() => self.folderAction('move')}><ml-icon icon="arrow-elbow-down-right" size="sm"></ml-icon>Move to…</div>
				<div class="ctx-sep"></div>
				<div class="ctx-item danger" @click=${() => self.folderAction('delete')}><ml-icon icon="trash" size="sm"></ml-icon>Delete folder…</div>
			</div>` : ''}

		<!-- dialogs -->
		<ml-dialog #new-chamber id="new-chamber" size="sm">
			<h3 slot="dialog-header">New chamber</h3>
			<div class="dlg">
				<p>A fresh repository, encrypted to your key. Add a remote now or later.</p>
				<ml-input label="Name" .value=${self.newName} @ml:input=${(e: CustomEvent) => (self.newName = e.detail.value)}></ml-input>
				<ml-input label="Repository URL (optional)" placeholder="git@github.com:you/secrets.git" .value=${self.newRemote} @ml:input=${(e: CustomEvent) => (self.newRemote = e.detail.value)}></ml-input>
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('new-chamber')}>Cancel</ml-button><ml-button variant="primary" ?disabled=${!self.newName.trim()} ?loading=${self.busy === 'create'} @ml:click=${() => self.createChamber()}>Create</ml-button></div>
		</ml-dialog>

		<ml-dialog #add id="add" size="md">
			<h3 slot="dialog-header">Add secret</h3>
			<div class="dlg">
				<p>${self.currentFolder ? html`Sealed into <b>${self.currentFolder}</b> and committed.` : 'Sealed at the top level and committed.'} Paste a single value, or a whole .env file.</p>
				<ml-input label="Name" placeholder="DATABASE_URL or railway.env" .value=${self.addName} @ml:input=${(e: CustomEvent) => (self.addName = e.detail.value)}></ml-input>
				<ml-textarea label="Value" rows="8" placeholder="postgres://…" .value=${self.addValue} @ml:input=${(e: CustomEvent) => (self.addValue = e.detail.value)}></ml-textarea>
				<p class="fineprint"><ml-icon icon="upload-simple" size="xs"></ml-icon>Have it as a file already? Use <i>Choose files…</i>, or drop files or folders anywhere in the window.</p>
			</div>
			<div slot="dialog-footer">
				<ml-button variant="ghost" @ml:click=${() => self.addFiles()}><ml-icon slot="icon-start" icon="file-arrow-up"></ml-icon>Choose files…</ml-button>
				<span class="grow"></span>
				<ml-button variant="outline" @ml:click=${() => self.closeDialog('add')}>Cancel</ml-button>
				<ml-button variant="primary" ?disabled=${!self.addPath || !self.addValue.trim()} ?loading=${self.busy === 'add'} @ml:click=${() => self.addSecret()}>Seal</ml-button>
			</div>
		</ml-dialog>

		<ml-dialog #new-folder id="new-folder" size="sm">
			<h3 slot="dialog-header">New folder</h3>
			<div class="dlg">
				<ml-input label="Name" placeholder=${self.newFolderParent ? 'staging' : 'production'} .value=${self.folderName} @ml:input=${(e: CustomEvent) => (self.folderName = e.detail.value)} @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && self.createFolder()}></ml-input>
				<div class="pick-label">Where</div>
				<div class="pick">
					<div class="pick-item ${self.newFolderParent === '' ? 'on' : ''}" @click=${() => (self.newFolderParent = '')}><ml-icon icon="lock" size="sm"></ml-icon><span class="grow">Top level</span></div>
					${self.rooms.map((r) => html`
						<div class="pick-item ${self.newFolderParent === r.name ? 'on' : ''}" style="padding-left: ${10 + r.depth * 14}px" @click=${() => (self.newFolderParent = r.name)}><ml-icon icon="folder" size="sm"></ml-icon><span class="grow">${r.label}</span></div>`)}
				</div>
				<p>${self.newFolderPath ? html`Will be <b>${self.newFolderPath}</b>.` : ''} Drag folders in the sidebar to reorder or nest them later.</p>
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('new-folder')}>Cancel</ml-button><ml-button variant="primary" ?disabled=${!self.newFolderPath} @ml:click=${() => self.createFolder()}>Create</ml-button></div>
		</ml-dialog>

		<ml-dialog #rename-folder id="rename-folder" size="sm">
			<h3 slot="dialog-header">Rename folder</h3>
			<div class="dlg">
				<p>Every secret inside moves with it, in one commit. To put it somewhere else, use <i>Move to…</i> or drag it onto another folder.</p>
				<ml-input label="Name" .value=${self.renameName} @ml:input=${(e: CustomEvent) => (self.renameName = e.detail.value)} @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && self.renameFolder()}></ml-input>
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('rename-folder')}>Cancel</ml-button><ml-button variant="primary" ?disabled=${!self.renameName.trim()} ?loading=${self.busy === 'folder'} @ml:click=${() => self.renameFolder()}>Rename</ml-button></div>
		</ml-dialog>

		<ml-dialog #delete-folder id="delete-folder" size="sm">
			<h3 slot="dialog-header">Delete folder ${self.targetFolder ?? ''}?</h3>
			<div class="dlg">
				${(() => { const f = self.targetFolder; const n = f ? self.entriesIn(f).length : 0; const parent = f ? roomOf(f) : ''; return n === 0 ? html`<p>It is empty, so nothing else changes.</p>` : html`<p>It holds <b>${n} secret${n === 1 ? '' : 's'}</b>. Keep them by moving them ${parent ? html`into <b>${parent}</b>` : 'to the top level'}, or delete them with the folder. Deleted secrets stay in git history, so rotate the credentials themselves if they were exposed.</p>`; })()}
			</div>
			<div slot="dialog-footer">
				<ml-button variant="outline" @ml:click=${() => self.closeDialog('delete-folder')}>Cancel</ml-button>
				${self.targetFolder && self.entriesIn(self.targetFolder).length ? html`
					<ml-button variant="outline" ?loading=${self.busy === 'folder'} @ml:click=${() => self.dissolveFolder()}>Keep secrets, remove folder</ml-button>
					<ml-button variant="danger" ?loading=${self.busy === 'folder'} @ml:click=${() => self.deleteFolderContents()}>Delete all</ml-button>` : html`
					<ml-button variant="danger" ?loading=${self.busy === 'folder'} @ml:click=${() => self.dissolveFolder()}>Delete</ml-button>`}
			</div>
		</ml-dialog>

		<ml-dialog #move-folder id="move-folder" size="sm">
			<h3 slot="dialog-header">Move ${self.targetFolder ? fileName(self.targetFolder) : ''}</h3>
			<div class="dlg">
				<p>The folder and everything in it moves in one commit. You can also drag folders onto each other in the sidebar.</p>
				<div class="pick">
					<div class="pick-item ${self.folderMoveTarget === '' ? 'on' : ''}" @click=${() => (self.folderMoveTarget = '')}><ml-icon icon="lock" size="sm"></ml-icon><span class="grow">Top level</span>${self.targetFolder && roomOf(self.targetFolder) === '' ? html`<span class="here">here</span>` : ''}</div>
					${(self.targetFolder ? self.folderTargetsFor(self.targetFolder) : []).map((r) => html`
						<div class="pick-item ${self.folderMoveTarget === r.name ? 'on' : ''}" style="padding-left: ${10 + r.depth * 14}px" @click=${() => (self.folderMoveTarget = r.name)}><ml-icon icon="folder" size="sm"></ml-icon><span class="grow">${r.label}</span>${self.targetFolder && roomOf(self.targetFolder) === r.name ? html`<span class="here">here</span>` : ''}</div>`)}
				</div>
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('move-folder')}>Cancel</ml-button><ml-button variant="primary" ?disabled=${!self.targetFolder || roomOf(self.targetFolder) === self.folderMoveTarget} ?loading=${self.busy === 'folder'} @ml:click=${() => self.moveFolderFromDialog()}>Move</ml-button></div>
		</ml-dialog>

		<ml-dialog #move id="move" size="sm">
			<h3 slot="dialog-header">Move ${self.selectedPath ? fileName(self.selectedPath) : ''}</h3>
			<div class="dlg">
				<div class="pick">
					<div class="pick-item ${self.moveTarget === '' && !self.moveNewFolder.trim() ? 'on' : ''}" @click=${() => { self.moveTarget = ''; self.moveNewFolder = ''; }}><ml-icon icon="lock" size="sm"></ml-icon><span class="grow">Top level</span>${self.selectedPath && roomOf(self.selectedPath) === '' ? html`<span class="here">here</span>` : ''}</div>
					${self.rooms.map((r) => html`
						<div class="pick-item ${self.moveTarget === r.name && !self.moveNewFolder.trim() ? 'on' : ''}" style="padding-left: ${10 + r.depth * 14}px" @click=${() => { self.moveTarget = r.name; self.moveNewFolder = ''; }}><ml-icon icon="folder" size="sm"></ml-icon><span class="grow">${r.label}</span>${self.selectedPath && roomOf(self.selectedPath) === r.name ? html`<span class="here">here</span>` : ''}</div>`)}
				</div>
				<ml-input label="Or a new folder" placeholder="team/staging" .value=${self.moveNewFolder} @ml:input=${(e: CustomEvent) => (self.moveNewFolder = e.detail.value)} @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && self.moveSelected()}></ml-input>
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('move')}>Cancel</ml-button><ml-button variant="primary" ?disabled=${!self.moveNewFolder.trim() && self.selectedPath !== null && roomOf(self.selectedPath) === self.moveTarget} ?loading=${self.busy === 'move'} @ml:click=${() => self.moveSelected()}>Move</ml-button></div>
		</ml-dialog>

		<ml-dialog #keepers id="keepers" size="md">
			<h3 slot="dialog-header">Keepers</h3>
			<div class="dlg">
				<p>Everyone who can open this chamber. Adding a keeper re-encrypts every secret to include their key.</p>
				${self.keepers.map((k) => html`
					<div class="keeper">
						<span class="tile" style="width:26px;height:26px;font-size:12px">${(k.label || 'K').charAt(0).toUpperCase()}</span>
						<div class="grow"><div>${k.label || 'Unnamed keeper'}${k.publicKey === self.status?.publicKey ? html` <ml-badge size="xs" variant="primary">you</ml-badge>` : ''}</div><div class="pk">${k.publicKey}</div></div>
						<ml-button variant="ghost" size="xs" title="Copy key" @ml:click=${() => self.copy(k.publicKey, 'Public key copied')}><ml-icon icon="copy" size="xs"></ml-icon></ml-button>
						${self.keepers.length > 1 ? html`<ml-button variant="ghost" size="xs" title="Remove" @ml:click=${() => self.removeKeeper(k)}><ml-icon icon="x" size="xs"></ml-icon></ml-button>` : ''}
					</div>`)}
				<ml-input label="Add a keeper" placeholder="age1…" .value=${self.newKeeperKey} @ml:input=${(e: CustomEvent) => (self.newKeeperKey = e.detail.value)}></ml-input>
				<ml-input placeholder="Label, like “Sam (laptop)”" .value=${self.newKeeperLabel} @ml:input=${(e: CustomEvent) => (self.newKeeperLabel = e.detail.value)}></ml-input>
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('keepers')}>Close</ml-button><ml-button variant="primary" ?disabled=${!self.newKeeperKey.trim().startsWith('age1')} ?loading=${self.busy === 'keeper'} @ml:click=${() => self.addKeeper()}>Add and rekey</ml-button></div>
		</ml-dialog>

		<ml-dialog #history id="history" size="md">
			<h3 slot="dialog-header">History · ${self.selectedPath ? fileName(self.selectedPath) : ''}</h3>
			<div class="dlg">
				<p>Every sealed version stays in git. Click one to view it; nothing is changed until you choose to.</p>
				${self.history.map((h) => html`<div class="hist" @click=${() => self.viewRevision(h.hash)}><span class="hash">${h.hash.slice(0, 7)}</span><span class="grow">${h.subject}<div style="font-size:12px;color:var(--ml-color-text-subtle)">${h.author}</div></span><span class="when">${longTime(h.date)}</span></div>`)}
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('history')}>Close</ml-button></div>
		</ml-dialog>

		<ml-dialog #edit id="edit" size="lg">
			<h3 slot="dialog-header">Edit · ${self.selectedPath ? fileName(self.selectedPath) : ''}</h3>
			<div class="dlg">
				<ml-textarea rows="16" .value=${self.editText} @ml:input=${(e: CustomEvent) => (self.editText = e.detail.value)}></ml-textarea>
				<p>Saving seals a new version and commits it. The previous one stays in history.</p>
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('edit')}>Cancel</ml-button><ml-button variant="primary" ?loading=${self.busy === 'edit'} @ml:click=${() => self.saveEdit()}>Seal changes</ml-button></div>
		</ml-dialog>

		<ml-dialog #delete id="delete" size="sm">
			<h3 slot="dialog-header">Remove ${self.selectedPath ? fileName(self.selectedPath) : ''}?</h3>
			<div class="dlg"><p>It leaves the chamber and every device on the next sync. Old versions stay in git history, so rotate the credential itself if it was exposed.</p></div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('delete')}>Keep it</ml-button><ml-button variant="danger" ?loading=${self.busy === 'delete'} @ml:click=${() => self.remove()}>Remove</ml-button></div>
		</ml-dialog>

		<ml-dialog #sync id="sync" size="md">
			<h3 slot="dialog-header">Sync</h3>
			<div class="dlg">
				<p>${c?.remote ?? ''}</p>
				<div style="display:flex; gap:8px; flex-wrap:wrap">
					<span class="chip">${sync?.ahead ?? 0} sealed here</span>
					<span class="chip">${sync?.behind ?? 0} from other devices</span>
					${sync?.dirty ? html`<span class="chip">uncommitted changes</span>` : ''}
				</div>
				${conflicts.length ? html`
					<p style="color: var(--ch-ember)">These changed on two devices. Pick which version to keep; the other stays in history.</p>
					${conflicts.map((p) => html`
						<div class="conflict-row"><span class="grow">${p.replace(/^vault\//, '').replace(/\.age$/, '')}</span>
							<ml-button size="xs" variant="outline" @ml:click=${() => self.resolve(p, 'mine')}>Keep mine</ml-button>
							<ml-button size="xs" variant="outline" @ml:click=${() => self.resolve(p, 'theirs')}>Keep theirs</ml-button>
						</div>`)}` : html`<p>Changes are committed as you make them. Sync pushes them and pulls what's new.</p>`}
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('sync')}>Close</ml-button><ml-button variant="primary" ?disabled=${conflicts.length > 0} ?loading=${self.syncing} @ml:click=${() => self.syncNow()}><ml-icon slot="icon-start" icon="arrows-clockwise"></ml-icon>Sync now</ml-button></div>
		</ml-dialog>

		<ml-dialog #settings id="settings" size="md">
			<h3 slot="dialog-header">Settings</h3>
			<div class="dlg">
				<p><b>Your public key</b></p>
				<div class="mono" style="font-size:12px; word-break: break-all; user-select: text">${self.status?.publicKey ?? ''}</div>
				<div><ml-button size="sm" variant="outline" @ml:click=${() => self.copy(self.status?.publicKey ?? '', 'Public key copied')}>Copy</ml-button></div>
				<p style="margin-top: 8px"><b>Recovery kit</b> · ${self.status?.recoverySaved ? 'saved' : 'not saved yet'}</p>
				<div style="display:flex; gap:8px">
					<ml-input type="password" placeholder="Passphrase (8+ characters)" .value=${self.kitPassphrase} @ml:input=${(e: CustomEvent) => (self.kitPassphrase = e.detail.value)}></ml-input>
					<ml-button size="md" variant="outline" ?disabled=${self.kitPassphrase.length < 8} ?loading=${self.busy === 'kit'} @ml:click=${() => self.saveKit()}>Save kit…</ml-button>
				</div>
				${c ? html`
					<p style="margin-top: 8px"><b>This chamber</b> · ${c.path}</p>
					<div><ml-button size="sm" variant="danger" @ml:click=${() => self.forgetChamber()}>Remove from this computer</ml-button></div>` : ''}
			</div>
			<div slot="dialog-footer"><ml-button variant="outline" @ml:click=${() => self.closeDialog('settings')}>Close</ml-button></div>
		</ml-dialog>
	`;
}
