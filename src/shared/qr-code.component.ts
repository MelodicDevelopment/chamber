import { MelodicComponent } from '@melodicdev/core/components';
import { html, css } from '@melodicdev/core/template';
import { create as createQr } from 'qrcode';

/**
 * A QR code drawn as one SVG path. Always black on white inside its own card,
 * whatever the app theme, because that is what cameras read best.
 */
@MelodicComponent({
	selector: 'chamber-qr',
	attributes: ['value', 'size'],
	template: (self: QrCode) => {
		const { n, d } = self.render();
		const px = Number(self.size) || 160;
		return html`
			<div class="card" style="width: ${px}px; height: ${px}px;" title=${self.value}>
				<svg viewBox="0 0 ${n} ${n}" width=${px} height=${px} shape-rendering="crispEdges" aria-label="QR code">
					<rect width=${n} height=${n} fill="#ffffff"></rect>
					<path d=${d} fill="#111111"></path>
				</svg>
			</div>
		`;
	},
	styles: () => css`
		:host { display: inline-flex; }
		.card { box-sizing: border-box; padding: 0; border-radius: 12px; overflow: hidden; background: #fff; border: 1px solid var(--ml-color-border-strong); box-shadow: var(--ml-shadow-md); }
		svg { display: block; width: 100%; height: 100%; }
	`,
})
export class QrCode {
	value = '';
	size = '160';

	/** Module grid → path. A 2-module quiet zone is baked into the viewBox. */
	render(): { n: number; d: string } {
		const text = this.value.trim();
		if (!text) return { n: 1, d: '' };
		try {
			const qr = createQr(text, { errorCorrectionLevel: 'M' });
			const size = qr.modules.size;
			const quiet = 2;
			const parts: string[] = [];
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					if (qr.modules.get(y, x)) parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
				}
			}
			return { n: size + quiet * 2, d: parts.join('') };
		} catch {
			return { n: 1, d: '' };
		}
	}
}
