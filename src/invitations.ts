export function guestLink(encoded: string): string {
  if (!encoded.startsWith("ulak:"))
    throw new Error("Invalid invitation format");
  const base64 = encoded.slice(5).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(
    atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    (char) => char.charCodeAt(0),
  );
  const invitation = JSON.parse(new TextDecoder().decode(bytes));
  const url = new URL(invitation.host.endpoint);
  url.hash = `invite=${encodeURIComponent(invitation.token)}`;
  return url.toString();
}
