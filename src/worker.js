import { logger } from "./logger.js";
import { config } from "./config.js";
import { startEmptyVehicleAlertScheduler } from "./services/statusCargaAlertaService.js";

if (config.readOnly) {
  logger.info("Worker desabilitado: modo somente consulta");
} else {
  startEmptyVehicleAlertScheduler();
  logger.info("Worker de alertas de veículos vazios iniciado; manutenção usa npm run worker:maintenance");
}
