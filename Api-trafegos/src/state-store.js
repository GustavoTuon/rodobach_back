import fs from "node:fs/promises";
import path from "node:path";

export class StateStore {
  constructor(filename) {
    this.filename = filename;
  }

  async load() {
    try {
      return JSON.parse(await fs.readFile(this.filename, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { initialized: false, sms: {}, routeChanges: {}, deliveries: [] };
    }
  }

  async save(state) {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(temporary, this.filename);
  }
}
