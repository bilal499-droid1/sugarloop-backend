import { Router } from 'express'
import * as healthController from '../controllers/health.controller.js'

const router = Router()

router.get('/live', healthController.live)
router.get('/ready', healthController.ready)

export default router
