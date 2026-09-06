import { MelodicComponent } from '@melodicdev/core/components';
import { html, css } from '@melodicdev/core/template';
import { Service } from '@melodicdev/core/injection';
import { RouterService } from '@melodicdev/core/routing';
import { ToastService } from '@melodicdev/components';
import { BackendService, asAppError, type HostInfo } from '../../services/backend.service';
import { pairingPayload, deviceLabel } from '../../shared/pairing';

type Mode = 'url' | 'connect' | 'browser' | 'token' | 'cloning';

@MelodicComponent({
	selector: 'chamber-join-page',
	template: (self: JoinPage) => html`
		<div class="hero">
			<div class="grid"></div>
			<div class="titlebar" data-tauri-drag-region>
				<ml-button variant="ghost" size="sm" @ml:click=${() => self.back()}><ml-icon slot="icon-start" icon="arrow-left"></ml-icon>Back</ml-button>
				<span class="lockup"><chamber-mark size="16"></chamber-mark><span class="inscr">Chamber</span></span>
			</div>
			<div class="center">
				<div class="card">
					<div class="head">
						<span class="eyebrow">${self.mode === 'url' ? 'Join a chamber' : `Join a chamber · Connect`}</span>
						<h1>${self.title}</h1>
						<p>${self.lede}</p>
					</div>

					${self.mode === 'url' ? html`
						<div class="section">
							<label>Repository</label>
							<ml-input placeholder="git@github.com:team/secrets.git" .value=${self.url} @ml:input=${(e: CustomEvent) => (self.url = e.detail.value)} @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && self.detect()}>
								<ml-icon slot="prefix" icon="link"></ml-icon>
							</ml-input>
							<div class="keybox">
								<chamber-qr value=${self.pairing} size="124"></chamber-qr>
								<div class="grow">
									<div class="keyhead"><span>Your public key</span><span class="grow"></span>
										<ml-button variant="ghost" size="xs" @ml:click=${() => self.copyKey()}><ml-icon slot="icon-start" icon="copy"></ml-icon>Copy</ml-button>
									</div>
									<div class="mono key"><span class="k">age1</span>${self.publicKey.slice(4)}</div>
									<div class="fine">A keeper can scan this code from their Keepers dialog, or you can send them the key. It only lets them encrypt to you, so it is safe to share anywhere. Your private key never leaves this computer.</div>
								</div>
							</div>
						</div>
						<div class="foot">
							<span class="status"><span class="pulse warn"></span>We'll unlock it automatically once you're added</span>
							<span class="btns"><ml-button variant="ghost" @ml:click=${() => self.back()}>Cancel</ml-button><ml-button variant="primary" ?disabled=${!self.url.trim()} ?loading=${self.busy} @ml:click=${() => self.detect()}>Continue</ml-button></span>
						</div>` : ''}

					${self.mode === 'connect' && self.host ? html`
						<div class="urlbar"><ml-icon icon="globe" size="sm"></ml-icon><span class="mono">${self.host.url}</span><ml-badge size="sm">${self.host.providerName}</ml-badge></div>
						<div class="options">
							${!self.host.isSsh ? html`
								<div class="opt ${self.host.gcmAvailable ? 'pick' : ''}">
									<span class="tile"><ml-icon icon="globe"></ml-icon></span>
									<div class="grow">
										<div class="title">Sign in with your browser</div>
										<div class="desc">${self.host.gcmAvailable ? `Opens ${self.host.host} to approve access. Handled by Git Credential Manager; the token is kept in your keychain.` : `Needs Git Credential Manager, which is not installed on this computer. ${self.host.gcmInstall.note}`}</div>
										${!self.host.gcmAvailable ? html`
											<div class="install">
												${self.host.gcmInstall.command ? html`
													<code class="cmd mono">${self.host.gcmInstall.command}</code>
													<ml-button variant="ghost" size="xs" title="Copy command" @ml:click=${() => self.copyText(self.host!.gcmInstall.command!, 'Command copied')}><ml-icon icon="copy" size="xs"></ml-icon></ml-button>` : ''}
												<a @click=${() => self.backend.openUrl(self.host!.gcmInstall.url)}>Install guide</a>
											</div>` : ''}
									</div>
									${self.host.gcmAvailable
										? html`<ml-button variant="primary" @ml:click=${() => self.viaBrowser()}>Sign in</ml-button>`
										: html`<ml-button variant="outline" ?loading=${self.busy} title="Look for Git Credential Manager again" @ml:click=${() => self.recheck()}>Check again</ml-button>`}
								</div>` : ''}
							${self.host.isSsh || self.host.sshUrl ? html`
								<div class="opt ${self.host.isSsh ? 'pick' : ''}">
									<span class="tile"><ml-icon icon="key"></ml-icon></span>
									<div class="grow"><div class="title">Use your SSH key</div><div class="desc">${self.host.sshKeyAvailable ? html`Key found in your agent${self.host.sshUrl ? html` · switch to <span class="mono small">${self.host.sshUrl}</span>` : ''}` : 'No key loaded in your SSH agent. Add one with ssh-add, or use another option.'}</div></div>
									<ml-button variant=${self.host.isSsh ? 'primary' : 'outline'} ?disabled=${!self.host.sshKeyAvailable} @ml:click=${() => self.viaSsh()}>${self.host.isSsh ? 'Connect' : 'Use SSH'}</ml-button>
								</div>` : ''}
							${!self.host.isSsh && self.host.credentialCached ? html`
								<div class="opt">
									<span class="tile"><ml-icon icon="check-circle"></ml-icon></span>
									<div class="grow"><div class="title">Use the credential already on this computer</div><div class="desc">Git has a saved login for ${self.host.host}.</div></div>
									<ml-button variant="outline" @ml:click=${() => self.clone()}>Connect</ml-button>
								</div>` : ''}
							${!self.host.isSsh ? html`
								<div class="opt">
									<span class="tile"><ml-icon icon="terminal"></ml-icon></span>
									<div class="grow"><div class="title">Paste a token</div><div class="desc">For self-hosted or locked-down hosts, or if the browser route is blocked.</div></div>
									<ml-button variant="outline" @ml:click=${() => (self.mode = 'token')}>Use a token</ml-button>
								</div>` : ''}
						</div>
						<div class="foot">
							<span class="status"><ml-icon icon="lock" size="xs"></ml-icon>Credentials never enter the chamber. Only this computer keeps them.</span>
							<span class="btns"><ml-button variant="ghost" @ml:click=${() => (self.mode = 'url')}>Back</ml-button></span>
						</div>` : ''}

					${self.mode === 'browser' ? html`
						<div class="wait">
							<span class="chip"><span class="pulse brass"></span>Waiting for your browser</span>
							<div class="desc">If nothing opened, sign in as the account that can see this repository. This screen continues on its own.</div>
							<ml-spinner size="sm"></ml-spinner>
						</div>
						<div class="foot">
							<span class="status">Git Credential Manager handles the sign-in and refresh.</span>
							<span class="btns"><ml-button variant="ghost" @ml:click=${() => (self.mode = 'connect')}>Cancel</ml-button></span>
						</div>` : ''}

					${self.mode === 'token' && self.host ? html`
						<div class="section">
							<label>Personal access token</label>
							<ml-input type="password" placeholder="Paste the token" .value=${self.token} @ml:input=${(e: CustomEvent) => (self.token = e.detail.value)}><ml-icon slot="prefix" icon="key"></ml-icon></ml-input>
							<label>Username <span class="fine">(usually fine as-is)</span></label>
							<ml-input .value=${self.username || self.host.tokenUsername} @ml:input=${(e: CustomEvent) => (self.username = e.detail.value)}></ml-input>
							<div class="keybox">
								<div class="keyhead"><ml-icon icon="terminal" size="sm"></ml-icon><span>Where to get one on ${self.host.providerName}</span></div>
								<div class="fine">Create a token with <span class="mono small">${self.host.tokenScope}</span>. Give it a name like <span class="mono small">chamber-${self.deviceName}</span> so you can revoke it later.${self.host.tokenPage ? html` <a href="#" @click=${(e: Event) => { e.preventDefault(); self.backend.openUrl(self.host!.tokenPage!); }}>Open that page</a>` : ''}</div>
							</div>
						</div>
						<div class="foot">
							<span class="status"><ml-icon icon="check" size="xs"></ml-icon>Checked against the host before anything is saved</span>
							<span class="btns"><ml-button variant="ghost" @ml:click=${() => (self.mode = 'connect')}>Back</ml-button><ml-button variant="primary" ?disabled=${!self.token.trim()} ?loading=${self.busy} @ml:click=${() => self.viaToken()}>Connect</ml-button></span>
						</div>` : ''}

					${self.mode === 'cloning' ? html`
						<div class="wait"><ml-spinner size="lg"></ml-spinner><div class="desc">Cloning the chamber…</div></div>` : ''}
				</div>
			</div>
		</div>
	`,
	styles: () => css`
		:host { display: block; height: 100vh; }
		.hero { position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden;
			background: radial-gradient(ellipse 55% 60% at 16% -10%, var(--ch-glow-a) 0%, transparent 62%), radial-gradient(ellipse 55% 65% at 88% 0%, var(--ch-glow-b) 0%, transparent 60%), radial-gradient(ellipse 40% 45% at 60% 100%, var(--ch-glow-c) 0%, transparent 65%), var(--ch-hero); }
		.grid { position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(var(--ch-grid) 1px, transparent 1px), linear-gradient(90deg, var(--ch-grid) 1px, transparent 1px); background-size: 72px 26px; -webkit-mask-image: radial-gradient(ellipse 75% 80% at 50% 25%, #000 0%, transparent 78%); mask-image: radial-gradient(ellipse 75% 80% at 50% 25%, #000 0%, transparent 78%); }
		.titlebar { position: relative; height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px 0 80px; flex-shrink: 0; }
		.lockup { display: inline-flex; align-items: center; gap: 7px; }
		.inscr { font-size: 11px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ch-brass); }
		.center { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 40px 24px; overflow: auto; }
		.card { width: 600px; box-sizing: border-box; border-radius: 24px; overflow: hidden; background: var(--ch-card-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid var(--ml-color-border-strong); box-shadow: var(--ml-shadow-xl), 0 0 40px rgba(79, 181, 138, 0.14); }
		.head { padding: 28px 32px 8px; }
		.eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ch-verdigris-light); }
		h1 { margin: 10px 0 0; font-size: 28px; font-weight: 700; line-height: 1.1; letter-spacing: -0.03em; }
		.head p { margin: 10px 0 0; font-size: 14px; color: var(--ml-color-text-muted); line-height: 1.6; }
		.section { padding: 12px 32px 8px; display: flex; flex-direction: column; gap: 8px; }
		label { font-size: 12px; font-weight: 600; color: var(--ml-color-text-muted); margin-top: 6px; }
		.keybox { margin-top: 8px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--ml-color-border); background: var(--ch-well); display: flex; align-items: flex-start; gap: 16px; }
		.keyhead { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--ml-color-text-muted); margin-bottom: 6px; }
		.grow { flex: 1; min-width: 0; }
		.mono { font-family: var(--ml-font-mono); }
		.small { font-size: 11px; color: var(--ml-color-text); }
		.key { font-size: 12px; line-height: 1.6; word-break: break-all; user-select: text; }
		.k { color: var(--ch-key); }
		.fine { font-size: 12px; color: var(--ml-color-text-subtle); line-height: 1.5; margin-top: 6px; }
		a { color: var(--ml-color-text-link); }
		.urlbar { margin: 12px 32px 0; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px; box-sizing: border-box; border: 1px solid var(--ml-color-border); border-radius: 8px; background: var(--ml-color-surface); font-size: 12px; overflow: hidden; }
		.urlbar .mono { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.options { padding: 16px 32px 4px; display: flex; flex-direction: column; gap: 10px; }
		.opt { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--ml-color-border); }
		.opt.pick { background: var(--ml-color-surface-raised); border-color: var(--ch-brass); box-shadow: 0 0 0 3px rgba(224, 166, 75, 0.14); }
		.tile { width: 36px; height: 36px; border-radius: 8px; background: linear-gradient(135deg, rgba(224, 166, 75, 0.16), rgba(79, 181, 138, 0.1)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
		.title { font-size: 14px; font-weight: 600; }
		.desc { font-size: 12px; color: var(--ml-color-text-muted); line-height: 1.5; }
		.install { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; flex-wrap: wrap; }
		.install .cmd { padding: 4px 8px; border-radius: 6px; background: var(--ch-well); border: 1px solid var(--ml-color-border); font-size: 11px; user-select: text; }
		.install a { cursor: pointer; font-weight: 500; }
		.wait { margin: 20px 32px 16px; padding: 22px 20px; border-radius: 12px; background: var(--ml-color-surface); border: 1px solid var(--ml-color-border); display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
		.chip { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px 0 12px; border-radius: 6px; background: var(--ml-color-surface-raised); border: 1px solid var(--ml-color-border); font-size: 12px; font-weight: 500; }
		.pulse { width: 8px; height: 8px; border-radius: 9999px; flex-shrink: 0; }
		.pulse.warn { background: var(--ch-brass); box-shadow: 0 0 0 4px rgba(217, 166, 82, 0.22); }
		.pulse.brass { background: var(--ch-brass); box-shadow: 0 0 0 4px rgba(217, 166, 82, 0.22); }
		.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 32px; margin-top: 12px; border-top: 1px solid var(--ml-color-border); background: var(--ch-foot); }
		.status { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ml-color-text-muted); }
		.btns { display: inline-flex; gap: 8px; }
	`,
})
export class JoinPage {
	@Service(BackendService) readonly backend!: BackendService;
	@Service(RouterService) private readonly router!: RouterService;
	@Service(ToastService) private readonly toast!: ToastService;

	mode: Mode = 'url';
	url = '';
	host: HostInfo | null = null;
	publicKey = '';
	deviceName = 'laptop';
	authorName = '';
	token = '';
	username = '';
	busy = false;

	get title(): string {
		switch (this.mode) {
			case 'connect': return `Connect to ${this.host?.providerName ?? 'the host'}`;
			case 'browser': return 'Finish in your browser';
			case 'token': return 'Paste a token';
			case 'cloning': return 'Almost there';
			default: return 'Ask for the keys.';
		}
	}
	get lede(): string {
		switch (this.mode) {
			case 'connect': return 'Chamber needs permission to read and push encrypted files here. Use whichever you already have; the host was detected from the address.';
			case 'browser': return `We opened ${this.host?.host}. Approve access there and this screen continues on its own.`;
			case 'token': return 'A personal access token with permission to read and write code. It stays in your keychain and is sent only to this host.';
			case 'cloning': return 'Fetching the encrypted files. Nothing is readable until a keeper adds your key.';
			default: return 'Paste the repository someone shared with you. The chamber clones now, but stays locked until a keeper adds your public key and syncs.';
		}
	}

	async onCreate() {
		try {
			const status = await this.backend.status();
			this.publicKey = status.publicKey ?? (await this.backend.publicKey());
			this.deviceName = status.deviceName;
			this.authorName = status.authorName;
		} catch (e) {
			this.toast.error('Could not read your key', asAppError(e).message);
		}
	}

	back() {
		this.router.back();
	}

	/** What the QR code carries: this device's public key and the keeper label it asks for. */
	get pairing(): string {
		return this.publicKey ? pairingPayload(this.publicKey, deviceLabel(this.authorName, this.deviceName)) : '';
	}

	async copyKey() {
		await this.copyText(this.publicKey, 'Public key copied');
	}

	async copyText(text: string, message: string) {
		try {
			await this.backend.copyText(text);
			this.toast.success(message);
		} catch (e) {
			this.toast.error('Could not copy', asAppError(e).message);
		}
	}

	/** After installing Git Credential Manager: look again without leaving this screen. */
	async recheck() {
		if (!this.host) return;
		this.busy = true;
		try {
			this.host = await this.backend.detectHost(this.host.url);
			if (this.host.gcmAvailable) this.toast.success('Git Credential Manager found', 'Sign in with your browser is ready.');
			else this.toast.info('Still not found', 'Install it, then check again. A new terminal may be needed for PATH changes; Chamber also looks in the usual install locations.');
		} catch (e) {
			this.toast.error('Could not check', asAppError(e).message);
		} finally {
			this.busy = false;
		}
	}

	async detect() {
		if (!this.url.trim()) return;
		this.busy = true;
		try {
			this.host = await this.backend.detectHost(this.url.trim());
			// SSH with a loaded key, or a cached credential: just go.
			if ((this.host.isSsh && this.host.sshKeyAvailable) || this.host.tokenStored) {
				await this.clone();
			} else {
				this.mode = 'connect';
			}
		} catch (e) {
			this.toast.error('Could not read that address', asAppError(e).message);
		} finally {
			this.busy = false;
		}
	}

	async viaSsh() {
		if (this.host && !this.host.isSsh && this.host.sshUrl) {
			this.url = this.host.sshUrl;
			this.host = await this.backend.detectHost(this.url);
		}
		await this.clone();
	}

	async viaBrowser() {
		// GCM opens the browser itself when git asks for credentials during the clone.
		this.mode = 'browser';
		await this.clone(true);
	}

	async viaToken() {
		this.busy = true;
		try {
			await this.backend.storeToken(this.url.trim(), this.token.trim(), this.username.trim() || undefined);
			this.token = '';
			await this.clone();
		} catch (e) {
			const err = asAppError(e);
			this.toast.error('That token did not work', err.message);
		} finally {
			this.busy = false;
		}
	}

	async clone(fromBrowser = false) {
		const previous = this.mode;
		if (!fromBrowser) this.mode = 'cloning';
		try {
			const chamber = await this.backend.joinChamber(this.url.trim());
			this.toast.success(`Joined ${chamber.name}`, chamber.hasAccess ? 'You can open it now.' : 'Waiting for a keeper to add your key.');
			this.router.navigate('/vault');
		} catch (e) {
			const err = asAppError(e);
			this.mode = err.kind === 'auth' ? 'connect' : previous === 'cloning' ? 'url' : previous;
			if (err.kind === 'auth') {
				this.toast.warning('Sign-in needed', 'The host would not let us in with what this computer has.');
			} else {
				this.toast.error('Could not join', err.message);
			}
		}
	}
}
