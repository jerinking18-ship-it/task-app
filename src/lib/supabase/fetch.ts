/** Bound provider requests without caching private data or retrying writes. */
export function createDeadlineFetch(fetcher: typeof fetch, timeoutMs = 8000): typeof fetch {
  return (input, init) => {
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetcher(input, { ...init, signal: caller ? AbortSignal.any([caller, timeout]) : timeout });
  };
}

// Resolve the runtime fetch at call time so Next's request handling stays intact.
export const appFetch = createDeadlineFetch((input, init) => fetch(input, init));
