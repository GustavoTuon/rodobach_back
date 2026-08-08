import { logger } from "./logger.js";
import { startEmptyVehicleAlertScheduler } from "./services/statusCargaAlertaService.js";
import { startMaintenanceAlertScheduler } from "./services/manutencaoAlertaService.js";

startEmptyVehicleAlertScheduler();
startMaintenanceAlertScheduler();
logger.info("Worker de alertas iniciado");
