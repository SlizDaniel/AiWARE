import { route } from './http'
/** Personal responses, including auth/validation errors, must never be cached. */
export function privateRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  const wrapped = route(handler)
  return async (...args: A) => {
    const response = await wrapped(...args)
    response.headers.set('Cache-Control','private, no-store')
    return response
  }
}
