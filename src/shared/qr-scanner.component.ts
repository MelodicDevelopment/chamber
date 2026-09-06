import { MelodicComponent } from '@melodicdev/core/components';
import { html, css } from '@melodicdev/core/template';
import jsQR from 'jsqr';

/** The platform barcode API where WebKit/Chromium expose it; jsQR otherwise. */
interface BarcodeDetectorLike {
	detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

/**
 * Webcam QR reader. Starts the camera when it appears in the DOM, stops it when
 * removed, and dispatches `ml:scan` ({ text }) once with the first code it reads.
 * `ml:error` ({ message }) fires if the camera cannot be opened.
 */
@MelodicComponent({
	selector: 'chamber-qr-scanner',
	template: (self: QrScanner) => html`
		<div class="cam ${self.ready ? 'live' : ''}">
			<video playsinline muted autoplay></video>
			<div class="reticle"></div>
			${!self.ready && !self.error ? html`<div class="state"><ml-spinner size="sm"></ml-spinner><span>Starting camera…</span></div>` : ''}
			${self.error ? html`<div class="state err"><ml-icon icon="video-camera-slash" size="lg"></ml-icon><span>${self.error}</span></div>` : ''}
		</div>
	`,
	styles: () => css`
		:host { display: block; }
		.cam { position: relative; width: 100%; aspect-ratio: 4 / 3; border-radius: 12px; overflow: hidden; background: #000; border: 1px solid var(--ml-color-border-strong); }
		video { width: 100%; height: 100%; object-fit: cover; display: block; transform: scaleX(-1); opacity: 0; transition: opacity 0.3s; }
		.live video { opacity: 1; }
		.reticle { position: absolute; inset: 14%; border-radius: 14px; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.32); pointer-events: none; }
		.reticle::before { content: ''; position: absolute; inset: -1px; border: 2px solid var(--ch-brass); border-radius: 14px; opacity: 0.9; }
		.state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #eee6d8; font-size: 13px; text-align: center; padding: 20px; }
		.state.err { color: #ef8d77; }
	`,
})
export class QrScanner {
	elementRef!: HTMLElement;
	ready = false;
	error = '';

	private _stream: MediaStream | null = null;
	private _timer: number | null = null;
	private _started = false;
	private _done = false;
	private _canvas: HTMLCanvasElement | null = null;

	onRender() {
		if (!this._started) {
			this._started = true;
			void this.start();
		}
	}

	onDestroy() {
		this.stop();
	}

	private video(): HTMLVideoElement | null {
		return this.elementRef?.shadowRoot?.querySelector('video') ?? null;
	}

	private async start() {
		if (!navigator.mediaDevices?.getUserMedia) {
			this.fail('This computer has no camera access. Paste the key instead.');
			return;
		}
		try {
			this._stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
		} catch (e) {
			const name = (e as { name?: string })?.name ?? '';
			this.fail(name === 'NotAllowedError' ? 'Camera access was denied. Allow it in System Settings, or paste the key instead.' : name === 'NotFoundError' ? 'No camera was found. Paste the key instead.' : 'Could not start the camera. Paste the key instead.');
			return;
		}
		const video = this.video();
		if (!video) return;
		video.srcObject = this._stream;
		try {
			await video.play();
		} catch {
			/* autoplay is allowed for muted video; ignore */
		}
		this.ready = true;
		const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
		const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
		this._timer = window.setInterval(() => void this.tick(video, detector), 180);
	}

	private async tick(video: HTMLVideoElement, detector: BarcodeDetectorLike | null) {
		if (this._done || video.readyState < 2) return;
		let text: string | null = null;
		if (detector) {
			try {
				const codes = await detector.detect(video);
				text = codes[0]?.rawValue ?? null;
			} catch {
				detector = null;
			}
		}
		if (!text && !detector) text = this.decodeWithJsQr(video);
		if (text) {
			this._done = true;
			this.stop();
			this.elementRef.dispatchEvent(new CustomEvent('ml:scan', { detail: { text }, bubbles: true, composed: true }));
		}
	}

	private decodeWithJsQr(video: HTMLVideoElement): string | null {
		const vw = video.videoWidth;
		const vh = video.videoHeight;
		if (!vw || !vh) return null;
		// Downscale for speed; QR codes on a laptop screen are large in frame.
		const scale = Math.min(1, 640 / vw);
		const w = Math.round(vw * scale);
		const h = Math.round(vh * scale);
		this._canvas ??= document.createElement('canvas');
		this._canvas.width = w;
		this._canvas.height = h;
		const ctx = this._canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		ctx.drawImage(video, 0, 0, w, h);
		const img = ctx.getImageData(0, 0, w, h);
		const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
		return code?.data ?? null;
	}

	private fail(message: string) {
		this.error = message;
		this.elementRef?.dispatchEvent(new CustomEvent('ml:error', { detail: { message }, bubbles: true, composed: true }));
	}

	stop() {
		if (this._timer) clearInterval(this._timer);
		this._timer = null;
		for (const t of this._stream?.getTracks() ?? []) t.stop();
		this._stream = null;
		const v = this.video();
		if (v) v.srcObject = null;
	}
}
