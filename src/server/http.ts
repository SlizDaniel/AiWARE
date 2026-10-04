// Route-handler helpers. Errors keep the FastAPI shape {"detail": "..."} that
// the frontend already reads.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail)
    this.name = 'HttpError'
  }
}

export function jsonError(status: number, detail: string): Response {
  return Response.json({ detail }, { status })
}

/** Wraps a route handler: HttpError → JSON error, anything else → logged 500. */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      if (error instanceof HttpError) return jsonError(error.status, error.detail)
      console.error(error)
      return jsonError(500, 'Wewnętrzny błąd serwera.')
    }
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object')
    return body as T
  } catch {
    throw new HttpError(422, 'Nieprawidłowy JSON w treści żądania.')
  }
}

/** Reads a raw request body with a hard size cap (Vercel limits bodies to 4.5 MB). */
export async function readBody(request: Request, maxBytes: number, tooLarge: string): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new HttpError(413, tooLarge)
  const data = new Uint8Array(await request.arrayBuffer())
  if (data.byteLength > maxBytes) throw new HttpError(413, tooLarge)
  return data
}

/** Positive integer path parameter or 422. */
export function intParam(value: string, label = 'id'): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new HttpError(422, `Nieprawidłowy parametr ${label}.`)
  return Number(value)
}
