import { Router } from 'express'
import staffAuthRoutes from './staffAuth.routes.js'
import staffUserRoutes from './staffUser.routes.js'
import staffOrderRoutes from './staffOrder.routes.js'
import stockRoutes from './stock.routes.js'
import staffEnquiryRoutes from './staffEnquiry.routes.js'
import staffProductRoutes from './staffProduct.routes.js'
import staffReportRoutes from './staffReport.routes.js'

const router = Router()

router.use('/auth', staffAuthRoutes)
router.use('/users', staffUserRoutes)
router.use('/orders', staffOrderRoutes)
router.use('/stock', stockRoutes)
router.use('/enquiries', staffEnquiryRoutes)
router.use('/products', staffProductRoutes)
router.use('/reports', staffReportRoutes)

export default router
