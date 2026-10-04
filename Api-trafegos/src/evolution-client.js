export class EvolutionClient {
  constructor({ url, key, instance, fetchImpl = fetch }) {
    this.url = url;
    this.key = key;
    this.instance = instance;
    this.fetch = fetchImpl;
  }

  async sendText(number, text) {
    const response = await this.fetch(`${this.url}/message/sendText/${encodeURIComponent(this.instance)}`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: {
        apikey: this.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({ number, text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Evolution API HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }
    return response.json();
  }
}
