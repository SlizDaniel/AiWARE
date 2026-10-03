// Post-login redirect target: only paths on this site. The WHATWG URL parser
// drops tabs/newlines and treats "\" like "/", so "/\t/evil.com" or "/\evil.com"
// would otherwise become the off-site "//evil.com".
const BASE = 'http://magazynier.invalid'

export function safeNextPath(value: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected here
  if (!value || !value.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(value)) return '/'
  try {
    const url = new URL(value, BASE)
    if (url.origin !== BASE || url.pathname.startsWith('//')) return '/'
    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}
