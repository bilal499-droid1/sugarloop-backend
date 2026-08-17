import { Router } from 'express'
import healthRoutes from './health.routes.js'
import staffRoutes from './staff.routes.js'
import customerAuthRoutes from './customerAuth.routes.js'
import productRoutes from './product.routes.js'
import branchRoutes from './branch.routes.js'
import checkoutRoutes from './checkout.routes.js'
import orderRoutes from './order.routes.js'

const router = Router()

router.use('/health', healthRoutes)
router.use('/staff', staffRoutes)
router.use('/auth', customerAuthRoutes)
router.use('/products', productRoutes)
router.use('/branches', branchRoutes)
router.use('/checkout', checkoutRoutes)
router.use('/orders', orderRoutes)

// Sprint 2 mounts this as it lands:
//   router.use('/enquiries', enquiryRoutes)

router.get('/', (_req, res) => {
  res.json({
    data: {
      name: 'Sugarloop API',
      version: 'v1',
      docs: '/api/v1/health/live',
    },
  })
})

export default router
