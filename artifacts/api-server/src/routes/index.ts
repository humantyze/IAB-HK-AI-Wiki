import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sectionsRouter from "./sections";
import authRouter from "./auth";
import uploadsRouter from "./uploads";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sectionsRouter);
router.use(authRouter);
router.use(uploadsRouter);

export default router;
