import { detectChanges } from "./change-detector.js";
import { buildRouteMessage } from "./message.js";

export class RouteMonitor {
  constructor({ trafegus, stateStore, phoneResolver, evolution, dryRun, logger = console }) {
    this.trafegus = trafegus;
    this.stateStore = stateStore;
    this.phoneResolver = phoneResolver;
    this.evolution = evolution;
    this.dryRun = dryRun;
    this.logger = logger;
    this.running = false;
  }

  async poll() {
    if (this.running) return { skipped: true };
    this.running = true;
    try {
      const state = await this.stateStore.load();
      const [sms, routeChanges] = await Promise.all([
        this.trafegus.getSms(),
        this.trafegus.getRouteChanges(),
      ]);
      const { next, events } = detectChanges(state, sms, routeChanges);
      const results = [];

      for (const event of events) {
        if (!event.sm.link_rota) {
          results.push({ sm: event.sm.id, status: "sem_link_rota" });
          continue;
        }
        const contact = await this.phoneResolver.resolve(event.sm);
        if (!contact?.number) {
          results.push({ sm: event.sm.id, status: "telefone_nao_encontrado" });
          continue;
        }
        const text = buildRouteMessage(event.sm, contact.name, event.reasons);
        if (this.dryRun) {
          this.logger.info(`[DRY RUN] SM ${event.sm.id}: envio para final ${contact.number.slice(-4)}`);
          results.push({ sm: event.sm.id, status: "dry_run" });
          continue;
        }
        await this.evolution.sendText(contact.number, text);
        next.deliveries.push({
          sm: event.sm.id,
          at: new Date().toISOString(),
          reasons: [...new Set(event.reasons)],
          phoneSuffix: contact.number.slice(-4),
        });
        next.deliveries = next.deliveries.slice(-1000);
        results.push({ sm: event.sm.id, status: "enviado" });
      }

      await this.stateStore.save(next);
      return { sms: sms.length, routeChanges: routeChanges.length, events: results };
    } finally {
      this.running = false;
    }
  }
}
