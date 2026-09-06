import { Injectable } from '@melodicdev/core/injection';
import { isDesktop } from './backend.service';

export interface StagedUpdate {
	currentVersion: string;
	version: string;
}

/**
 * In-app updates via tauri-plugin-updater. The release workflow publishes a
 * signed `latest.json` next to each GitHub release; the plugin checks it,
 * verifies the minisign signature against the public key in tauri.conf.json,
 * and downloads the installer. Nothing here can block or break startup: every
 * failure resolves to "no update".
 *
 * Tauri plugin modules are imported lazily so the browser preview never loads them.
 */
@Injectable()
export class UpdatesService {
	private _staged: { install(): Promise<void> } | null = null;

	/** Check for a newer version and download it in the background. Null when current, offline, or anything fails. */
	async stage(): Promise<StagedUpdate | null> {
		if (!isDesktop()) return null;
		try {
			const { check } = await import('@tauri-apps/plugin-updater');
			const update = await check();
			if (!update) return null;
			await update.download();
			this._staged = update;
			return { currentVersion: update.currentVersion, version: update.version };
		} catch {
			return null;
		}
	}

	/** Install the staged update and relaunch. On Windows the installer quits the app itself, so relaunch may not return. */
	async restart(): Promise<void> {
		if (!this._staged) return;
		const { relaunch } = await import('@tauri-apps/plugin-process');
		await this._staged.install();
		await relaunch();
	}
}
