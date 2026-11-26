/**
 * Helpers to keep secrets and personal data out of public API responses.
 */

/** Mask a customer email: "alice@corp.io" -> "a***@corp.io" */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

/** Mask a webhook signing secret, keeping only the last 4 chars visible. */
export function maskSecret(secret: string): string {
  return `whsec_****${secret.slice(-4)}`
}