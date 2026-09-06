import { MelodicComponent } from '@melodicdev/core/components';
import { html, css } from '@melodicdev/core/template';
import { Service } from '@melodicdev/core/injection';
import { RouterService } from '@melodicdev/core/routing';
import { ToastService } from '@melodicdev/components';
import { BackendService, asAppError, type AppStatus } from '../../services/backend.service';

type Step = 'loading' | 'recovery' | 'repo' | 'done';

@MelodicComponent({
	selector: 'chamber-welcome-page',
	template: (self: WelcomePage) => html`
		<div class="hero">
			<div class="grid"></div>
			<div class="titlebar" data-tauri-drag-region>
				<span class="lockup"><chamber-mark size="16"></chamber-mark><span class="inscr">Chamber</span></span>
			</div>
			<div class="center">
				${self.step === 'loading'
					? html`<ml-spinner size="lg"></ml-spinner>`
					: html`
						<div class="card">
							<div class="head">
								<span class="chip"><span class="pulse ok"></span>${self.status?.identityExists ? 'Key kept in your keychain' : 'Creating your key…'}</span>
								<h1>The chamber is <span class="accent">${self.step === 'done' ? 'open.' : 'sealed.'}</span></h1>
								<p>A new encryption key was made just now and stored in your operating system's keychain. Nothing can open this chamber without it, so keep a recovery copy off this computer.</p>
							</div>

							<div class="steps">
								<div class="step">
									<div class="num ${self.recoverySaved ? 'done' : self.step === 'recovery' ? 'current' : ''}">${self.recoverySaved ? html`<ml-icon icon="check" size="xs" format="bold"></ml-icon>` : '1'}</div>
									<div class="body">
										<div class="title">Save your recovery kit</div>
										<div class="desc">A passphrase-protected copy of your key. Without it, a lost laptop means a lost chamber.</div>
										${self.recoverySaved
											? html`<div class="saved"><ml-badge variant="success" pill size="sm">Saved</ml-badge><span>${self.savedTo}</span></div>`
											: html`
												<div class="fields">
													<ml-input type="password" placeholder="Passphrase (8+ characters)" .value=${self.passphrase} @ml:input=${(e: CustomEvent) => (self.passphrase = e.detail.value)}></ml-input>
													<ml-input type="password" placeholder="Repeat passphrase" .value=${self.passphrase2} @ml:input=${(e: CustomEvent) => (self.passphrase2 = e.detail.value)} error=${self.passphraseError}></ml-input>
													<ml-button variant="primary" ?disabled=${!self.canSaveKit} ?loading=${self.busy === 'kit'} @ml:click=${() => self.saveKit()}>Save kit…</ml-button>
												</div>`}
									</div>
								</div>

								<div class="step">
									<div class="num ${self.step === 'done' ? 'done' : self.step === 'repo' ? 'current' : ''}">${self.step === 'done' ? html`<ml-icon icon="check" size="xs" format="bold"></ml-icon>` : '2'}</div>
									<div class="body">
										<div class="title">Choose where secrets sync</div>
										<div class="desc">A private Git repository. Every change is committed for you, and only encrypted files ever leave this computer.</div>
										${self.step === 'done'
											? html`<div class="saved"><ml-badge variant="success" pill size="sm">Ready</ml-badge><span>${self.status?.chambers[0]?.name}</span></div>`
											: html`
												<div class="fields">
													<ml-input placeholder="Chamber name" .value=${self.name} @ml:input=${(e: CustomEvent) => (self.name = e.detail.value)}></ml-input>
													<ml-input placeholder="Repository URL (optional for now)" hint="git@github.com:you/secrets.git or https://…" .value=${self.remote} @ml:input=${(e: CustomEvent) => (self.remote = e.detail.value)}></ml-input>
													<div class="row">
														<ml-button variant="primary" ?disabled=${!self.name.trim() || self.busy !== ''} ?loading=${self.busy === 'create'} @ml:click=${() => self.create()}>Create chamber</ml-button>
														<ml-button variant="ghost" @ml:click=${() => self.router.navigate('/join')}>Join one instead</ml-button>
													</div>
												</div>`}
									</div>
								</div>
							</div>

							<div class="foot">
								<span class="hint">You can change any of this later in Settings.</span>
								<ml-button variant="primary" size="lg" ?disabled=${self.step !== 'done'} @ml:click=${() => self.router.navigate('/vault')}>Open chamber</ml-button>
							</div>
						</div>`}
			</div>
		</div>
	`,
	styles: () => css`
		:host { display: block; height: 100vh; }
		.hero {
			position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden;
			background:
				radial-gradient(ellipse 55% 60% at 16% -10%, var(--ch-glow-a) 0%, transparent 62%),
				radial-gradient(ellipse 55% 65% at 88% 0%, var(--ch-glow-b) 0%, transparent 60%),
				radial-gradient(ellipse 40% 45% at 60% 100%, var(--ch-glow-c) 0%, transparent 65%),
				var(--ch-hero);
		}
		.grid {
			position: absolute; inset: 0; pointer-events: none;
			background-image: linear-gradient(var(--ch-grid) 1px, transparent 1px), linear-gradient(90deg, var(--ch-grid) 1px, transparent 1px);
			background-size: 72px 26px;
			-webkit-mask-image: radial-gradient(ellipse 75% 80% at 50% 25%, #000 0%, transparent 78%);
			mask-image: radial-gradient(ellipse 75% 80% at 50% 25%, #000 0%, transparent 78%);
		}
		.titlebar { position: relative; height: 52px; display: flex; align-items: center; justify-content: flex-end; padding: 0 18px; flex-shrink: 0; }
		.lockup { display: inline-flex; align-items: center; gap: 7px; }
		.inscr { font-size: 11px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ch-brass); }
		.center { position: relative; flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 40px 24px; overflow: auto; }
		.card {
			width: 600px; box-sizing: border-box; border-radius: 24px; overflow: hidden;
			background: var(--ch-card-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
			border: 1px solid var(--ml-color-border-strong); box-shadow: var(--ml-shadow-xl), 0 0 40px rgba(224, 166, 75, 0.18);
		}
		.head { padding: 24px 32px 6px; display: flex; flex-direction: column; align-items: flex-start; }
		.chip { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px 0 12px; border-radius: 6px; background: var(--ml-color-surface-raised); border: 1px solid var(--ml-color-border); font-size: 12px; font-weight: 500; }
		.pulse { width: 8px; height: 8px; border-radius: 9999px; }
		.pulse.ok { background: var(--ch-verdigris); box-shadow: 0 0 0 4px rgba(79, 181, 138, 0.22); }
		h1 { margin: 18px 0 0; font-size: 32px; font-weight: 700; line-height: 1.1; letter-spacing: -0.03em; }
		.accent { color: var(--ch-brass); }
		.head p { margin: 12px 0 0; font-size: 14px; color: var(--ml-color-text-muted); line-height: 1.6; }
		.steps { padding: 6px 32px 12px; }
		.step { display: flex; align-items: flex-start; gap: 16px; padding: 16px 0; }
		.step + .step { border-top: 1px solid var(--ml-color-border); }
		.num { width: 26px; height: 26px; box-sizing: border-box; border-radius: 9999px; border: 1px solid var(--ml-color-border-strong); color: var(--ml-color-text-subtle); font-family: var(--ml-font-mono); font-size: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
		.num.current { border: 1.5px solid var(--ch-brass); color: var(--ch-brass); box-shadow: 0 0 0 3px rgba(224, 166, 75, 0.14); }
		.num.done { background: var(--ch-brass); border-color: var(--ch-brass); color: var(--ch-brass-ink); box-shadow: 0 4px 14px rgba(224, 166, 75, 0.3); }
		.body { flex: 1; min-width: 0; }
		.title { font-size: 14px; font-weight: 600; }
		.desc { font-size: 13px; color: var(--ml-color-text-muted); margin-top: 2px; }
		.fields { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
		.row { display: flex; gap: 8px; }
		.saved { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 12px; color: var(--ml-color-text-muted); }
		.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 32px; border-top: 1px solid var(--ml-color-border); background: var(--ch-foot); }
		.hint { font-size: 12px; color: var(--ml-color-text-subtle); }
	`,
})
export class WelcomePage {
	@Service(BackendService) private readonly backend!: BackendService;
	@Service(RouterService) readonly router!: RouterService;
	@Service(ToastService) private readonly toast!: ToastService;

	status: AppStatus | null = null;
	step: Step = 'loading';
	recoverySaved = false;
	savedTo = '';
	passphrase = '';
	passphrase2 = '';
	name = 'Personal';
	remote = '';
	busy: '' | 'kit' | 'create' = '';

	get passphraseError(): string {
		return this.passphrase2 && this.passphrase !== this.passphrase2 ? 'Passphrases differ' : '';
	}
	get canSaveKit(): boolean {
		return this.passphrase.length >= 8 && this.passphrase === this.passphrase2 && this.busy === '';
	}

	async onCreate() {
		await this.refresh();
	}

	async refresh() {
		try {
			// Touching the public key creates the identity on first launch.
			await this.backend.publicKey();
			this.status = await this.backend.status();
			this.recoverySaved = this.status.recoverySaved;
			if (this.status.chambers.length > 0 && this.status.recoverySaved) {
				this.router.navigate('/vault');
				return;
			}
			this.step = this.status.chambers.length > 0 ? 'done' : this.recoverySaved ? 'repo' : 'recovery';
		} catch (e) {
			this.step = 'recovery';
			this.toast.error('Could not reach the keychain', asAppError(e).message);
		}
	}

	async saveKit() {
		this.busy = 'kit';
		try {
			const path = await this.backend.pickSavePath('chamber-recovery-kit.age');
			if (!path) return;
			await this.backend.exportRecoveryKit(this.passphrase, path);
			await this.backend.markRecoverySaved();
			this.recoverySaved = true;
			this.savedTo = path;
			this.passphrase = this.passphrase2 = '';
			this.step = (this.status?.chambers.length ?? 0) > 0 ? 'done' : 'repo';
			this.toast.success('Recovery kit saved', 'Keep it somewhere that is not this computer.');
		} catch (e) {
			this.toast.error('Could not save the kit', asAppError(e).message);
		} finally {
			this.busy = '';
		}
	}

	async create() {
		this.busy = 'create';
		try {
			await this.backend.createChamber(this.name.trim(), this.remote.trim() || undefined);
			this.status = await this.backend.status();
			this.step = 'done';
			this.toast.success('Chamber created', this.remote.trim() ? 'Connected to your repository.' : 'You can connect a repository later.');
		} catch (e) {
			const err = asAppError(e);
			if (err.kind === 'auth') {
				this.toast.warning('Repository needs sign-in', 'Use Join instead to connect with a token or browser sign-in.');
			} else {
				this.toast.error('Could not create the chamber', err.message);
			}
		} finally {
			this.busy = '';
		}
	}
}
