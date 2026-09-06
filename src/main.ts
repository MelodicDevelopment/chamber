import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

import '@melodicdev/core/routing';
import './components';

import { bootstrap } from '@melodicdev/core/bootstrap';
import { initTheme } from './shared/theme';

await bootstrap({
	target: '#app',
	rootComponent: 'app-root',
	devMode: import.meta.env.DEV,
	onBefore: () => {
		initTheme();
	},
});
