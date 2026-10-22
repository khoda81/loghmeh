export const DINING_ORIGIN = 'https://dining2.ut.ac.ir';
export const HOST_PERMISSION = `${DINING_ORIGIN}/*`;

const operations = Object.freeze({
  bootstrap: { path: '/Reserves', method: 'GET', fields: [] },
  restaurants: { path: '/Reserves/GetRestaurantByPersonGroup', method: 'POST', fields: ['personGroupId'] },
  menu: { path: '/Reserves/GetReservePage', method: 'POST', fields: ['personGroupId', 'restId'] },
});

export class ProbeError extends Error {
  constructor(code, message, diagnostic = {}) {
    super(message);
    this.name = 'ProbeError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export function publicError(error) {
  return error instanceof ProbeError
    ? { code: error.code, message: error.message, diagnostic: error.diagnostic }
    : { code: 'unexpected-error', message: 'The check did not complete. Please try again.', diagnostic: {} };
}

export function buildReadRequest(operation, parameters = {}) {
  if (!Object.hasOwn(operations, operation)) {
    throw new ProbeError('invalid-request', 'This probe only supports reading groups, restaurants, and a menu.');
  }
  const definition = operations[operation];
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)
      || Object.keys(parameters).some(key => !definition.fields.includes(key))) {
    throw new ProbeError('invalid-request', 'Unexpected request fields.');
  }
  const fields = {};
  for (const name of definition.fields) {
    const value = parameters[name];
    if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d{0,11}$/.test(String(value))) {
      throw new ProbeError('invalid-request', 'Choose a valid group and restaurant first.');
    }
    fields[name] = String(value);
  }
  if (operation === 'menu') fields.isKiosk = 'false';
  const headers = { Accept: operation === 'restaurants' ? 'application/json' : 'text/html' };
  const init = { method: definition.method, credentials: 'include', redirect: 'manual', cache: 'no-store', headers };
  if (definition.method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    headers['X-Requested-With'] = 'XMLHttpRequest';
    init.body = new URLSearchParams(fields).toString();
  }
  return { url: DINING_ORIGIN + definition.path, init, path: definition.path };
}

// One shared queue, including across UI tabs. Failed reads do not poison it.
export function createReadTransport(fetcher = fetch, { timeoutMs = 20000 } = {}) {
  let queue = Promise.resolve();
  async function perform(operation, parameters) {
    const { url, init, path } = buildReadRequest(operation, parameters);
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const diagnostic = { operation, path, method: init.method, status: null };
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal });
      diagnostic.status = response.status;
      if (response.type === 'opaqueredirect' || response.status === 0 || response.status === 401
          || (response.status >= 300 && response.status < 400) || response.redirected) {
        throw new ProbeError('login-required', 'Sign in to dining in this browser, then check again.');
      }
      if (!response.ok) {
        throw new ProbeError('server-error', `Dining returned HTTP ${response.status}. The request was not retried.`);
      }
      if (response.url) {
        const destination = new URL(response.url);
        if (destination.origin !== DINING_ORIGIN || destination.pathname !== path) {
          throw new ProbeError('unexpected-response', 'The server returned an unexpected destination.');
        }
      }
      return { operation, body: await response.text(), diagnostic };
    } catch (error) {
      if (error instanceof ProbeError) {
        error.diagnostic = diagnostic;
        throw error;
      }
      if (controller.signal.aborted) {
        throw new ProbeError('timeout', 'Dining took too long to respond. Nothing was submitted.', diagnostic);
      }
      throw new ProbeError('network-error', 'Could not reach dining. Check the connection and extension site access.', diagnostic);
    } finally {
      diagnostic.elapsedMs = Math.round(performance.now() - started);
      clearTimeout(timer);
    }
  }
  return {
    read(operation, parameters) {
      const job = queue.then(() => perform(operation, parameters));
      queue = job.catch(() => {});
      return job.catch(error => {
        // Only predefined messages and request metadata may leave this layer.
        if (error instanceof ProbeError) throw error;
        throw new ProbeError('unexpected-error', 'The check did not complete.');
      });
    },
  };
}
