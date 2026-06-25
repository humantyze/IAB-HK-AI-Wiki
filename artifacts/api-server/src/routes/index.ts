import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import superAuthRouter from "./super-auth";
import uploadsRouter from "./uploads";
import wikiRouter from "./wiki";
import knowledgeRouter from "./knowledge";
import regressRouter from "./regress";
import backupRouter from "./backup";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(superAuthRouter);
router.use(uploadsRouter);
router.use(wikiRouter);
router.use(knowledgeRouter);
router.use(regressRouter);
router.use(backupRouter);

export default router;
