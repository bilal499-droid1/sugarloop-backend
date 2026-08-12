import mongoose from 'mongoose'
import { env } from './env.js'
import { logger } from './logger.js'

// Reject writes that don't match a schema path. Mongoose's default is to silently
// drop unknown fields, which turns a typo like `grandTotl` into a missing total
// rather than an error. On an orders API that is not an acceptable default.
mongoose.set('strictQuery', true)

// Never let a slow query hang a request forever — fail it and return a 500 that
// shows up in monitoring instead of a socket that stays open until the client gives up.
mongoose.set('bufferTimeoutMS', 10_000)

export async function connectDatabase() {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'))
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'))
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'))

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    // Atlas free/shared tiers cap connections; a modest pool avoids exhausting them
    // when Render runs more than one instance.
    maxPoolSize: 20,
    minPoolSize: 2,
  })

  return mongoose.connection
}

export async function disconnectDatabase() {
  await mongoose.connection.close(false)
  logger.info('MongoDB connection closed')
}
