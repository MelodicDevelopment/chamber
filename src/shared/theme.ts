/**
 * Appearance: Chamber ships dark (obsidian) by default, with a warm-stone light
 * theme and a follow-the-OS mode. The choice lives in localStorage; the Melodic
 * theme function sets `data-theme` on <html>, which global.css keys off.
 */
import { applyTheme, getResolvedTheme } from '@melodicdev/components/theme';
import { isDesktop } from '../services/backend.service';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'chamber.theme';

export function savedTheme(): ThemeMode {
	try {
		const v = localStorage.getItem(KEY);
		if (v === 'light' || v === 'dark' || v === 'system') return v;
	} catch {
		/* private mode or blocked storage */
	}
	return 'dark';
}

export function setTheme(mode: ThemeMode): void {
	try {
		localStorage.setItem(KEY, mode);
	} catch {
		/* ignore */
	}
	applyTheme(mode);
	void syncWindowChrome(mode);
}

export function initTheme(): void {
	applyTheme(savedTheme());
	void syncWindowChrome(savedTheme());
}

/** Keep the native title bar (traffic lights, overlay) in step with the page. */
async function syncWindowChrome(mode: ThemeMode): Promise<void> {
	if (!isDesktop()) return;
	try {
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		await getCurrentWindow().setTheme(mode === 'system' ? null : getResolvedTheme());
	} catch {
		/* older runtime or permission missing: the page still themes itself */
	}
}
