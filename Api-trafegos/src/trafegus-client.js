const LOGIN_FORM_MARKER = 'id="usua_login"';

function cookiePairs(headers) {
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return raw.map((item) => item.split(";", 1)[0]).filter((item) => item.includes("="));
}

export class TrafegusClient {
  constructor({ webUrl, user, password, fetchImpl = fetch }) {
    this.webUrl = webUrl;
    this.user = user;
    this.password = password;
    this.fetch = fetchImpl;
    this.cookies = new Map();
  }

  rememberCookies(headers) {
    for (const pair of cookiePairs(headers)) {
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  cookieHeader() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async request(path, options = {}, redirects = 5) {
    const response = await this.fetch(`${this.webUrl}${path}`, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      redirect: "manual",
      headers: {
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...(options.headers || {}),
      },
    });
    this.rememberCookies(response.headers);

    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (!redirects) throw new Error("Redirecionamentos excessivos no Trafegus");
      const target = new URL(response.headers.get("location"), `${this.webUrl}${path}`);
      const base = new URL(this.webUrl);
      if (target.origin !== base.origin) throw new Error("Redirecionamento externo inesperado no Trafegus");
      const nextPath = `${target.pathname}${target.search}`.replace(base.pathname.replace(/\/$/, ""), "");
      return this.request(nextPath || "/", { method: "GET" }, redirects - 1);
    }
    return response;
  }

  async login() {
    await this.request("/login");
    const body = new URLSearchParams({
      login: this.user,
      senha: this.password,
      submit: "ACESSAR",
      token_recapcha: "",
      propriedadesTela: "",
    });
    const response = await this.request("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const html = await response.text();
    if (!response.ok || html.includes(LOGIN_FORM_MARKER)) {
      throw new Error("Login recusado pelo Trafegus");
    }
  }

  async postDataTable(path, { start = 0, length = 100 } = {}) {
    const body = new URLSearchParams({
      draw: "1",
      start: String(start),
      length: String(length),
      "search[value]": "",
      "order[0][column]": "0",
      "order[0][dir]": "desc",
    });
    let response = await this.request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    if (response.status === 401 || response.status === 403) {
      await this.login();
      response = await this.request(path, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    }
    if (!response.ok) throw new Error(`Trafegus ${path}: HTTP ${response.status}`);
    const text = await response.text();
    if (text.includes(LOGIN_FORM_MARKER)) {
      await this.login();
      return this.postDataTable(path, { start, length });
    }
    return JSON.parse(text);
  }

  async allRows(path) {
    const first = await this.postDataTable(path, { start: 0, length: 100 });
    const firstRows = Array.isArray(first.data) ? first.data : [];
    const total = Number(first.recordsFiltered ?? first.recordsTotal ?? firstRows.length);
    if (!firstRows.length || firstRows.length >= total) return firstRows;

    // O Elite OP limita algumas grades a 10 linhas mesmo quando length=100.
    // Buscamos as páginas restantes com no máximo 4 requisições simultâneas.
    const pageSize = firstRows.length;
    const starts = [];
    for (let start = pageSize; start < total; start += pageSize) starts.push(start);
    const pages = [];
    let cursor = 0;

    async function worker(client) {
      while (cursor < starts.length) {
        const index = cursor++;
        pages[index] = await client.postDataTable(path, {
          start: starts[index],
          length: pageSize,
        });
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, starts.length) }, () => worker(this)));
    return [
      ...firstRows,
      ...pages.flatMap((page) => Array.isArray(page?.data) ? page.data : []),
    ].slice(0, total);
  }

  getSms() {
    // As grades são ordenadas pelos registros mais recentes no portal. Monitorar
    // a primeira página evita varrer todo o histórico a cada minuto.
    return this.postDataTable("/solicitacaomonitoramento/getjsondata", {
      start: 0,
      length: 50,
    }).then((page) => Array.isArray(page.data) ? page.data : []);
  }

  getRouteChanges() {
    return this.postDataTable("/relatorioalteracaorotasviagem/getjsondata", {
      start: 0,
      length: 50,
    }).then((page) => Array.isArray(page.data) ? page.data : []);
  }
}
