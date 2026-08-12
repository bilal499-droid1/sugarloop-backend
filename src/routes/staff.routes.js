import { Router } from 'express'
import staffAuthRoutes from './staffAuth.routes.js'
import staffUserRoutes from './staffUser.routes.js'

const router = Router()

router.use('/auth', staffAuthRoutes)
router.use('/users', staffUserRoutes)

// Sprint 1 mounts the dashboard itself here as it lands:
//   router.use('/orders', staffOrderRoutes)    // days 11-13

export default router
