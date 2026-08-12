import { Router } from 'express'
import healthRoutes from './health.routes.js'
import staffRoutes from './staff.routes.js'
import productRoutes from './product.routes.js'
import branchRoutes from './branch.routes.js'

const router = Router()

router.use('/health', healthRoutes)
router.use('/staff', staffRoutes)
router.use('/products', productRoutes)
router.use('/branches', branchRoutes)

// Sprint 1 mounts these as they land:
//   router.use('/checkout', checkoutRoutes)    // days 6-8
//   router.use('/orders',   orderRoutes)       // days 9-10

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
