import { MelodicComponent } from '@melodicdev/core/components';
import { html, css } from '@melodicdev/core/template';
import type { IRoute } from '@melodicdev/core/routing';
import { routes } from '../../routes';

@MelodicComponent({
	selector: 'app-root',
	template: (self: AppComponent) => html`<router-outlet .routes=${self.routes}></router-outlet>`,
	styles: () => css`
		:host {
			display: block;
			height: 100vh;
		}
	`,
})
export class AppComponent {
	routes: IRoute[] = routes;
}
