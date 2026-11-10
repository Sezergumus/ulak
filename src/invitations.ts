import type { Remote } from "./types";

export function readInvitation(encoded: string): {
  host: Remote;
  token: string;
} {
  if (!encoded.startsWith("ulak:") || encoded.length > 65_536)
    throw new Error("Paste the full invitation from the other computer.");
  const base64 = encoded.slice(5).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    (char) => char.charCodeAt(0),
  );
  const invitation = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !invitation?.host?.identity?.id ||
    !invitation.host.identity.name ||
    !invitation.host.endpoint ||
    !invitation.host.ca_pem ||
    !invitation.token
  )
    throw new Error("This invitation is incomplete. Ask for a new one.");
  return invitation;
}

export function guestLink(encoded: string): string {
  const invitation = readInvitation(encoded);
  const url = new URL(invitation.host.endpoint);
  url.hash = `invite=${encodeURIComponent(invitation.token)}`;
  return url.toString();
}
