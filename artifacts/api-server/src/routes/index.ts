import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sectionsRouter from "./sections";
import authRouter from "./auth";
import superAuthRouter from "./super-auth";
import uploadsRouter from "./uploads";
import wikiRouter from "./wiki";
import regressRouter from "./regress";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sectionsRouter);
router.use(authRouter);
router.use(superAuthRouter);
router.use(uploadsRouter);
router.use(wikiRouter);
router.use(regressRouter);

export default router;
