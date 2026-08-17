import { Router } from 'express'
import staffAuthRoutes from './staffAuth.routes.js'
import staffUserRoutes from './staffUser.routes.js'
import staffOrderRoutes from './staffOrder.routes.js'
import stockRoutes from './stock.routes.js'

const router = Router()

router.use('/auth', staffAuthRoutes)
router.use('/users', staffUserRoutes)
router.use('/orders', staffOrderRoutes)
router.use('/stock', stockRoutes)

// Sprint 2 mounts these as they land:
//   router.use('/enquiries', staffEnquiryRoutes)
//   router.use('/reports',   staffReportRoutes)

export default router
