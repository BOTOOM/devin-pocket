export function coalescedModelFetch(
  upstream: typeof fetch,
  prefix: string,
  persist: (url: string, response: Response) => Promise<void>,
): typeof fetch {
  const pending = new Map<string, Promise<Response>>();
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(prefix)) return upstream(input, init);
    let download = pending.get(url);
    if (!download) {
      download = upstream(input, init);
      pending.set(url, download);
      void download
        .then(async (response) => {
          if (response.ok) await persist(url, response.clone());
        })
        .catch(() => {})
        .finally(() => pending.delete(url));
    }
    return (await download).clone();
  };
}
