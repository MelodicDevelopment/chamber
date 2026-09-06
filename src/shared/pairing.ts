/**
 * Device pairing payload: what one device shows as a QR code and another scans
 * to add it as a keeper. It is exactly one line of `.chamber/recipients`:
 * the age public key, a space, a label. Nothing secret is ever encoded.
 */
const AGE_KEY = /age1[02-9ac-hj-np-z]{58}/i;

export interface Pairing {
	publicKey: string;
	label: string;
}

export function pairingPayload(publicKey: string, label: string): string {
	return `${publicKey.trim()} ${label.trim()}`.trim();
}

/** Accepts the payload above, a bare key, or a key pasted with surrounding noise. */
export function parsePairing(text: string): Pairing | null {
	const m = text.match(AGE_KEY);
	if (!m) return null;
	const publicKey = m[0].toLowerCase();
	const label = text.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
	return { publicKey, label };
}

/** The keeper label this device asks for: author name plus device, like the one `chamber_create` writes for itself. */
export function deviceLabel(author: string, device: string): string {
	const a = author.trim();
	const d = device.trim();
	return a && d ? `${a} (${d})` : a || d || 'device';
}
