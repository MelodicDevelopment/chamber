import { MelodicComponent } from '@melodicdev/core/components';
import { html, css } from '@melodicdev/core/template';

/** The Chamber mark: a keyhole inside a double ring, brass. */
@MelodicComponent({
	selector: 'chamber-mark',
	attributes: ['size'],
	template: (self: KeyholeMark) => html`
		<svg viewBox="0 0 24 24" style="width: ${self.size}px; height: ${self.size}px;" aria-hidden="true">
			<defs>
				<linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stop-color="#F2CD86"></stop>
					<stop offset="1" stop-color="#B87C34"></stop>
				</linearGradient>
			</defs>
			<circle cx="12" cy="12" r="10.5" fill="none" stroke="url(#brass)" stroke-width="1.6"></circle>
			<circle cx="12" cy="12" r="7.2" fill="none" stroke="url(#brass)" stroke-width="0.8" opacity="0.5"></circle>
			<path d="M12 6.8a3.1 3.1 0 0 0-1.4 5.87L9.6 17.2h4.8l-1-4.53A3.1 3.1 0 0 0 12 6.8z" fill="url(#brass)"></path>
		</svg>
	`,
	styles: () => css`
		:host {
			display: inline-flex;
			flex-shrink: 0;
		}
	`,
})
export class KeyholeMark {
	size = '24';
}
