import type { IRoute } from '@melodicdev/core/routing';

export const routes: IRoute[] = [
	{ path: '', redirectTo: '/welcome' },
	{ path: 'welcome', component: 'chamber-welcome-page' },
	{ path: 'vault', component: 'chamber-vault-page' },
	{ path: 'join', component: 'chamber-join-page' },
	{ path: '**', redirectTo: '/welcome' },
];
