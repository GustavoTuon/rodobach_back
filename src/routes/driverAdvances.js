import express from 'express';
import {requirePermission} from '../middleware/permissions.js';
import {driverAdvances} from '../services/driverAdvances.js';
export const driverAdvancesRouter=express.Router();
driverAdvancesRouter.get('/viagens/adiantamentos-motoristas',requirePermission('viagens'),async(_req,res,next)=>{
  try {res.set('Cache-Control','no-store').json(await driverAdvances());}catch(error){next(error);}
});
