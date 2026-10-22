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

const navigation = Object.freeze({ current: '/Reserves/GetCurrentReservePage',
  next: '/Reserves/GetNextReservePage', previous: '/Reserves/GetPreReservePage' });
export function buildDiningRequest(operation, parameters = {}) {
  if (Object.hasOwn(operations, operation)) return buildReadRequest(operation, parameters);
  if (!Object.hasOwn(navigation, operation) && operation !== 'submit') {
    throw new ProbeError('invalid-request', 'Unknown dining operation.');
  }
  const fields = ['personGroupId', 'restId', ...(operation === 'submit' ? ['firstEWalletId', 'records'] : [])];
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)
      || Object.keys(parameters).some(key => !fields.includes(key))) throw new ProbeError('invalid-request', 'Unexpected request fields.');
  const body = new URLSearchParams();
  for (const name of fields.filter(name => name !== 'records')) {
    if (!/^[1-9]\d{0,11}$/.test(String(parameters[name] ?? ''))) throw new ProbeError('invalid-request', 'Invalid dining identifier.');
    body.set(name, String(parameters[name]));
  }
  if (operation === 'submit') {
    if (!Array.isArray(parameters.records) || !parameters.records.length || parameters.records.length > 140
        || parameters.records.some(record => typeof record !== 'string' || record.length > 4000
          || !/^rr[\w.-]+(?:t|f)fco\d+pco\d+options\|[\d;|-]*\|diet:[01]$/u.test(record))) {
      throw new ProbeError('invalid-request', 'Invalid reservation records.');
    }
    body.set('type', 'Index');
    for (const record of parameters.records) body.append('DataId[]', record);
  } else body.set('isKiosk', 'false');
  const path = operation === 'submit' ? '/Reserves/Index' : navigation[operation];
  return { url: DINING_ORIGIN + path, path, init: { method: 'POST', credentials: 'include', redirect: 'manual',
    cache: 'no-store', headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest' }, body: body.toString() } };
}

// One shared queue, including across UI tabs. Failed reads do not poison it.
function createTransport(builder, fetcher, { timeoutMs = 20000 } = {}) {
  let queue = Promise.resolve();
  async function perform(operation, parameters) {
    const { url, init, path } = builder(operation, parameters);
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
        throw new ProbeError(operation === 'submit' ? 'save-unknown' : 'timeout', operation === 'submit'
          ? 'The save response was lost. Check reservations before trying again.'
          : 'Dining took too long to respond. Nothing was submitted.', diagnostic);
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

export const createReadTransport = (fetcher = fetch, options) => createTransport(buildReadRequest, fetcher, options);
export const createDiningTransport = (fetcher = fetch, options) => {
  const transport = createTransport(buildDiningRequest, fetcher, options);
  return { request: transport.read };
};
