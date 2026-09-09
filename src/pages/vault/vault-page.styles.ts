import { css } from '@melodicdev/core/template';

export function vaultPageStyles() {
	return css`
		:host { display: flex; height: 100vh; overflow: hidden; background: var(--ml-color-background); }
		.mono { font-family: var(--ml-font-mono); }
		.inscr { font-size: 10px; font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase; color: var(--ch-brass); }
		.grow { flex: 1; min-width: 0; }
		.pulse { width: 8px; height: 8px; border-radius: 9999px; flex-shrink: 0; }
		.pulse.ok { background: var(--ch-verdigris); box-shadow: 0 0 0 4px rgba(79, 181, 138, 0.22); }
		.pulse.pending { background: var(--ch-ember); box-shadow: 0 0 0 4px rgba(232, 120, 95, 0.22); }
		.pulse.off { background: var(--ml-color-text-subtle); }
		.chip { display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 12px; border-radius: 6px; background: var(--ml-color-surface-raised); border: 1px solid var(--ml-color-border); color: var(--ml-color-text-muted); font-size: 12px; font-weight: 500; white-space: nowrap; cursor: default; }
		.chip.on { background: var(--ch-chip-on); color: var(--ml-color-text); border-color: var(--ml-color-border-strong); }
		.chip.btn { cursor: pointer; }
		.chip.btn:hover { border-color: var(--ml-color-border-strong); color: var(--ml-color-text); }

		/* ---- sidebar ---- */
		aside { position: relative; width: var(--sidebar-w, 248px); flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--ml-color-border);
			background: radial-gradient(ellipse 70% 40% at 10% 0%, var(--ch-glow-a) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 100% 8%, var(--ch-glow-b) 0%, transparent 60%), radial-gradient(ellipse 70% 40% at 50% 100%, var(--ch-glow-c) 0%, transparent 65%), var(--ch-sidebar); }
		aside .grid { position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(var(--ch-grid) 1px, transparent 1px), linear-gradient(90deg, var(--ch-grid) 1px, transparent 1px); background-size: 72px 26px; -webkit-mask-image: radial-gradient(ellipse 90% 60% at 50% 0%, #000 0%, transparent 80%); mask-image: radial-gradient(ellipse 90% 60% at 50% 0%, #000 0%, transparent 80%); }
		.titlebar { position: relative; height: 52px; display: flex; align-items: center; justify-content: flex-end; padding: 0 18px; flex-shrink: 0; }
		.lockup { display: inline-flex; align-items: center; gap: 7px; }
		.lockup .inscr { font-size: 11px; letter-spacing: 0.3em; }
		.switcher { position: relative; margin: 2px 12px 14px; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
		.switcher:hover, .switcher.open { background: var(--ml-color-surface-raised); border-color: var(--ml-color-border-strong); }
		.tile { width: 30px; height: 30px; border-radius: 8px; background: var(--ch-brass); color: var(--ch-brass-ink); font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
		.tile.dim { background: var(--ml-color-surface-raised); color: var(--ml-color-text-muted); border: 1px solid var(--ml-color-border); }
		.switcher .name { font-size: 15px; font-weight: 600; line-height: 1.2; }
		.switcher .repo { font-size: 11px; color: var(--ml-color-text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		nav { position: relative; flex: 1; overflow: auto; }
		.nav-label { display: block; padding: 16px 20px 6px; }
		.nav-head { display: flex; align-items: center; padding-right: 12px; }
		.nav-head .nav-label { flex: 1; }
		.nav-head ml-button { margin-top: 10px; color: var(--ml-color-text-subtle); }
		.nav-hint { margin: 0 20px 4px; font-size: 12px; line-height: 1.45; color: var(--ml-color-text-subtle); }
		.nav-item.pending { color: var(--ml-color-text-subtle); }
		.nav-item.pending ml-icon { opacity: 0.7; }
		.nav-item.pending .label { font-style: italic; }
		.nav-item.folder { user-select: none; -webkit-user-select: none; touch-action: none; }
		.nav-item.lifting { opacity: 0.45; }
		.update-pill { display: flex; align-items: center; gap: 8px; margin: 0 12px 8px; padding: 9px 12px; border: 1px solid var(--ch-brass); border-radius: 8px; background: var(--ch-brass-glow); color: var(--ml-color-text); font: inherit; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer; }
		.update-pill:hover { background: var(--ml-color-primary-subtle); }
		.update-pill ml-icon { color: var(--ch-brass); }
		.update-pill .go { font-size: 11px; color: var(--ch-brass); white-space: nowrap; }
		.nav-item.drop-before::after, .nav-item.drop-after::after { content: ''; position: absolute; left: 8px; right: 8px; height: 2px; border-radius: 2px; background: var(--ch-brass); box-shadow: 0 0 0 3px rgba(224, 166, 75, 0.18); pointer-events: none; }
		.nav-item.drop-before::after { top: -2px; }
		.nav-item.drop-after::after { bottom: -2px; }
		.nav-item .more { display: none; align-items: center; justify-content: center; width: 22px; height: 22px; margin: -4px -6px -4px 0; border-radius: 6px; color: var(--ml-color-text-subtle); }
		.nav-item .more:hover { background: var(--ch-hover-strong); color: var(--ml-color-text); }
		.nav-item.folder:hover .more, .nav-item.menu-on .more { display: inline-flex; }
		.nav-item.folder:hover .count, .nav-item.menu-on .count { display: none; }
		.nav-item.menu-on { background: var(--ml-color-surface-raised); color: var(--ml-color-text); }
		.ctx { position: fixed; z-index: 70; min-width: 210px; padding: 6px; border-radius: 12px; background: var(--ch-popover); border: 1px solid var(--ml-color-border-strong); box-shadow: var(--ml-shadow-xl); font-size: 13px; }
		.ctx-title { padding: 6px 10px 8px; font-family: var(--ml-font-mono); font-size: 11px; color: var(--ml-color-text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.ctx-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; color: var(--ml-color-text); }
		.ctx-item:hover { background: var(--ch-hover); }
		.ctx-item.danger { color: var(--ch-ember); }
		.ctx-sep { height: 1px; margin: 4px 6px; background: var(--ml-color-border); }
		.nav-item { position: relative; display: flex; align-items: center; gap: 12px; margin: 0 12px; padding: 9px 12px; border-radius: 8px; color: var(--ml-color-text-muted); font-size: 14px; font-weight: 500; line-height: 1.25; cursor: pointer; }
		.nav-item + .nav-item { margin-top: 2px; }
		.nav-item:hover { background: var(--ch-hover); color: var(--ml-color-text); }
		.nav-item.active { background: var(--ml-color-surface-raised); color: var(--ml-color-text); }
		.nav-item.active::before { content: ''; position: absolute; left: -8px; top: 8px; bottom: 8px; width: 3px; border-radius: 3px; background: var(--ch-brass); }
		.nav-item.target { box-shadow: 0 0 0 1px var(--ch-brass), 0 0 0 4px rgba(224, 166, 75, 0.14); background: var(--ml-color-surface-raised); color: var(--ml-color-text); }
		.nav-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.nav-item .count { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ml-color-text-subtle); }
		.nav-item.active .count { color: var(--ml-color-text); }
		.user { position: relative; display: flex; align-items: center; gap: 12px; margin: 12px; padding: 10px 12px; border-radius: 12px; background: var(--ml-color-surface); border: 1px solid var(--ml-color-border); }
		.user .name { font-size: 13px; font-weight: 500; }
		.user .meta { font-size: 11px; color: var(--ml-color-text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

		.menu { position: fixed; left: 12px; top: 112px; width: 300px; z-index: 66; border-radius: 16px; background: var(--ch-popover); border: 1px solid var(--ml-color-border-strong); box-shadow: var(--ml-shadow-xl), 0 0 40px rgba(224, 166, 75, 0.12); overflow: hidden; }
		.menu-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px 8px; }
		.menu-list { padding: 0 6px 6px; display: flex; flex-direction: column; gap: 2px; }
		.menu-item { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 10px; cursor: pointer; }
		.menu-item:hover { background: var(--ch-hover); }
		.menu-item.active { background: var(--ml-color-surface-raised); }
		.menu-item .name { font-size: 14px; font-weight: 600; line-height: 1.3; }
		.menu-item .repo { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ml-color-text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.menu-item .state { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ml-color-text-muted); white-space: nowrap; }
		.menu-sep { height: 1px; margin: 0 12px; background: var(--ml-color-border); }
		.menu-action { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; }
		.menu-action:hover { background: var(--ch-hover); }
		.menu-action .tile { width: 32px; height: 32px; background: linear-gradient(135deg, rgba(224, 166, 75, 0.16), rgba(79, 181, 138, 0.1)); color: var(--ml-color-text); }
		.scrim { position: fixed; inset: 0; z-index: 65; }

		/* ---- resizable dividers: a thin hit area straddling each border, brass while dragging ---- */
		.resizer { position: absolute; top: 0; bottom: 0; right: -4px; width: 8px; z-index: 5; cursor: col-resize; touch-action: none; }
		.resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px; background: var(--ch-brass); opacity: 0; transition: opacity 0.15s; }
		.resizer:hover::after, .resizer.on::after { opacity: 1; }
		aside .resizer { right: 0; } /* aside clips overflow, so keep its handle inside */
		aside .resizer::after { left: 6px; }
		:host(.resizing) { cursor: col-resize; user-select: none; }
		:host(.resizing) * { pointer-events: none; }
		:host(.resizing) .resizer { pointer-events: auto; }

		/* ---- main ---- */
		main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
		header { height: 52px; flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding: 0 20px; box-sizing: border-box; background: var(--ch-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--ml-color-border); }
		.search { display: flex; align-items: center; gap: 8px; width: 300px; height: 36px; padding: 0 14px; box-sizing: border-box; border: 1px solid var(--ml-color-border); border-radius: 9999px; background: var(--ml-color-surface); color: var(--ml-color-text-subtle); font-size: 14px; }
		.search:focus-within { border-color: var(--ch-brass); box-shadow: 0 0 0 3px rgba(224, 166, 75, 0.14); }
		.search input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: var(--ml-color-text); font: inherit; }
		.search input::placeholder { color: var(--ml-color-text-subtle); }
		.kbd { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ml-color-text-subtle); border: 1px solid var(--ml-color-border); border-radius: 6px; padding: 1px 6px; }
		section { flex: 1; min-height: 0; padding: 20px; box-sizing: border-box; }
		.card { height: 100%; display: flex; background: var(--ml-color-surface); border: 1px solid var(--ml-color-border); border-radius: 16px; box-shadow: var(--ml-shadow-xl); overflow: hidden; }

		/* ---- list ---- */
		.list { position: relative; width: var(--list-w, 372px); flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--ml-color-border); }
		.list-head { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 12px; border-bottom: 1px solid var(--ml-color-border); }
		.list-head-top, .list-head-bar { display: flex; align-items: center; gap: 8px; min-width: 0; }
		.list-head .title { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.list-head .count { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ml-color-text-subtle); }
		.filters { display: flex; gap: 6px; }
		.filters .chip { height: 24px; padding: 0 10px; font-size: 11px; }
		.rows { flex: 1; overflow: auto; }
		.row { position: relative; display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 16px 0 18px; box-sizing: border-box; border-bottom: 1px solid var(--ml-color-border); cursor: pointer; }
		.row:hover { background: var(--ch-hover); }
		.row.selected { background: var(--ml-color-surface-raised); }
		.row.selected::before { content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 3px; border-radius: 0 3px 3px 0; background: var(--ch-brass); }
		.row .ftile { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, rgba(224, 166, 75, 0.16), rgba(79, 181, 138, 0.1)); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
		.row .name { font-size: 14px; font-weight: 500; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.row .meta { font-size: 12px; color: var(--ml-color-text-subtle); line-height: 1.35; }
		.row.selected .meta { color: var(--ch-dim); }
		.row.lifting { opacity: 0.45; }
		.rows .row { user-select: none; -webkit-user-select: none; touch-action: none; }
		.ghost { position: fixed; z-index: 60; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; background: var(--ch-popover); border: 1px solid var(--ch-brass); box-shadow: var(--ml-shadow-xl), 0 0 24px rgba(224, 166, 75, 0.18); font-size: 13px; font-weight: 500; pointer-events: none; white-space: nowrap; }
		.ghost ml-icon { color: var(--ch-brass); }
		.ghost .to { font-size: 11px; color: var(--ml-color-text-subtle); margin-left: 4px; }
		.row .when { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ml-color-text-subtle); margin-left: auto; }
		.row .conflict { margin-left: auto; height: 22px; padding: 0 8px; font-size: 11px; color: var(--ch-ember); background: rgba(232, 120, 95, 0.1); border-color: rgba(232, 120, 95, 0.3); }
		.list-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--ml-color-border); font-size: 12px; color: var(--ml-color-text-subtle); }
		.list-foot > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
		.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px; text-align: center; color: var(--ml-color-text-muted); }
		.empty .big { font-size: 16px; font-weight: 600; color: var(--ml-color-text); }

		/* ---- detail ---- */
		.detail { flex: 1; min-width: 0; display: flex; flex-direction: column; }
		/* Name and tags on top, the toolbar beneath: the pane is too narrow for both side by side once four buttons are in it. */
		.detail-head { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px 16px; }
		.detail-head .title { font-size: 20px; font-weight: 600; line-height: 1.2; letter-spacing: -0.02em; overflow-wrap: anywhere; user-select: text; }
		.detail-head .tags { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: var(--ml-color-text-subtle); flex-wrap: wrap; }
		.detail-head .tags .chip { height: 22px; padding: 0 9px; font-size: 11px; }
		.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
		.actions > ml-button:last-child { margin-left: auto; }
		.strip { display: flex; align-items: center; gap: 10px; margin: 0 20px 12px; padding: 9px 12px; border-radius: 10px; background: rgba(232, 120, 95, 0.1); border: 1px solid rgba(232, 120, 95, 0.3); font-size: 13px; }
		.strip ml-icon { color: var(--ch-ember); }
		.strip a { color: var(--ch-ember); font-weight: 600; cursor: pointer; }
		.code { flex: 1; min-height: 0; margin: 0 20px; display: flex; flex-direction: column; border: 1px solid var(--ml-color-border); border-radius: 12px; background: var(--ch-code-bg); overflow: hidden; }
		.code-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--ch-code-head); border-bottom: 1px solid var(--ml-color-border); font-size: 12px; color: var(--ml-color-text-subtle); flex-shrink: 0; }
		.dot { width: 10px; height: 10px; border-radius: 9999px; }
		.code-head .path { margin-left: auto; font-family: var(--ml-font-mono); }
		.code-body { flex: 1; overflow: auto; padding: 10px 8px; }
		.ln { display: flex; align-items: center; gap: 12px; min-height: 34px; padding: 0 12px 0 16px; border-radius: 8px; font-family: var(--ml-font-mono); font-size: 13px; }
		.ln .n { width: 18px; text-align: right; color: var(--ch-mask); font-size: 11px; flex-shrink: 0; }
		.ln .k { color: var(--ch-key); width: 210px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.ln .eq { color: var(--ml-color-text-subtle); }
		.ln .v { color: var(--ch-mask); letter-spacing: 0.1em; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
		.ln .v.plain { color: var(--ml-color-text-muted); letter-spacing: 0; cursor: default; white-space: pre-wrap; }
		.ln.on { background: var(--ml-color-surface-raised); }
		.ln.on .n, .ln.on .eq { color: var(--ch-dim); }
		.ln.on .v { color: var(--ch-string); letter-spacing: 0; user-select: text; white-space: pre-wrap; word-break: break-all; }
		.ln .timer { height: 22px; padding: 0 8px; font-size: 11px; color: var(--ch-verdigris-light); border-color: rgba(79, 181, 138, 0.35); background: rgba(79, 181, 138, 0.1); flex-shrink: 0; }
		.ln ml-button { flex-shrink: 0; }
		.textblock { padding: 6px 12px; font-family: var(--ml-font-mono); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--ch-string); user-select: text; }
		.textblock.masked { color: var(--ch-mask); letter-spacing: 0.08em; cursor: pointer; user-select: none; }
		.binary { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--ml-color-text-muted); font-size: 13px; }
		.detail-foot { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px 16px; font-size: 12px; color: var(--ml-color-text-subtle); }
		.detail-foot .links { display: inline-flex; gap: 14px; }
		.detail-foot a { color: var(--ml-color-text-link); cursor: pointer; font-weight: 500; }
		.placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--ml-color-text-subtle); font-size: 13px; }
		.locked { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px; text-align: center; }
		.locked .big { font-size: 18px; font-weight: 600; }
		.locked .key { font-family: var(--ml-font-mono); font-size: 12px; word-break: break-all; user-select: text; padding: 10px 14px; border-radius: 8px; background: var(--ml-color-surface-raised); border: 1px solid var(--ml-color-border); max-width: 520px; }
		.locked .lede { color: var(--ml-color-text-muted); font-size: 13px; max-width: 460px; }
		.pair { display: flex; align-items: center; gap: 20px; margin-top: 6px; padding: 18px; border-radius: 16px; background: var(--ml-color-surface-raised); border: 1px solid var(--ml-color-border); text-align: left; max-width: 560px; }
		.pair .side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
		.pair .fine { font-size: 12px; color: var(--ml-color-text-subtle); line-height: 1.5; }
		.pair .btns { display: flex; gap: 8px; flex-wrap: wrap; }
		.pair.compact { padding: 12px; gap: 14px; margin-top: 0; }
		.seg { display: flex; gap: 6px; }
		.seg .chip ml-icon { margin-right: -2px; }
		.scanrow { display: flex; align-items: center; gap: 12px; margin-top: 2px; }

		/* ---- drop overlay ---- */
		.drop { position: absolute; left: 20px; top: 72px; right: 20px; bottom: 20px; z-index: 40; border-radius: 16px; padding: 2px; background: var(--ch-brass); box-shadow: 0 0 40px rgba(224, 166, 75, 0.18); pointer-events: none; }
		.drop-inner { height: 100%; box-sizing: border-box; border-radius: 14px; background: var(--ch-scrim); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
		.drop .tile { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, rgba(224, 166, 75, 0.16), rgba(79, 181, 138, 0.1)); color: var(--ch-brass); border: 1px solid var(--ml-color-border); margin-bottom: 8px; }
		.drop .big { font-size: 30px; font-weight: 700; color: var(--ch-brass); letter-spacing: -0.02em; }
		.drop .desc { font-size: 15px; color: var(--ml-color-text-muted); }
		.drop .desc b { color: var(--ml-color-text); font-weight: 600; }
		.drop .fine { font-size: 12px; color: var(--ml-color-text-subtle); margin-top: 18px; }

		/* ---- dialogs ---- */
		.dlg { display: flex; flex-direction: column; gap: 10px; min-width: 360px; }
		.dlg p { margin: 0; color: var(--ml-color-text-muted); font-size: 13px; line-height: 1.55; }
		.dlg .fineprint { font-size: 12px; color: var(--ml-color-text-subtle); }
		.dlg .fineprint ml-icon { vertical-align: -2px; margin-right: 6px; }
		.keeper { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--ml-color-border); }
		.keeper .pk { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ml-color-text-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.hist { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: 8px; cursor: pointer; }
		.hist:hover { background: var(--ml-color-surface-raised); }
		.hist .hash { font-family: var(--ml-font-mono); font-size: 11px; color: var(--ch-key); }
		.hist .when { font-size: 12px; color: var(--ml-color-text-subtle); margin-left: auto; white-space: nowrap; }
		.conflict-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--ml-color-border); font-family: var(--ml-font-mono); font-size: 12px; }
		ml-textarea { --ml-textarea-font-family: var(--ml-font-mono); }
		.foot-btns { display: flex; gap: 8px; justify-content: flex-end; }
		[slot="dialog-footer"] { display: flex; align-items: center; justify-content: flex-end; gap: 10px; width: 100%; box-sizing: border-box; }
		[slot="dialog-footer"] ml-button { flex-shrink: 0; }
		.pick-label { font-family: var(--ml-font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ml-color-text-subtle); }
		.pick { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow: auto; padding: 4px; border: 1px solid var(--ml-color-border); border-radius: 10px; background: var(--ml-color-background); }
		.pick-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; font-size: 13px; cursor: pointer; color: var(--ml-color-text-muted); }
		.pick-item:hover { background: var(--ch-hover); color: var(--ml-color-text); }
		.pick-item.on { background: var(--ml-color-surface-raised); color: var(--ml-color-text); box-shadow: inset 3px 0 0 var(--ch-brass); }
		.pick-item .here { font-family: var(--ml-font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ch-brass); }
	`;
}
