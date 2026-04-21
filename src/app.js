
import Fastify from 'fastify'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { loadConfig } from './config/config.mjs'
import { webHandler } from './handlers/webHandler.mjs'
import { apiHandler } from './handlers/apiHandler.mjs'

const createServer = async (config) => {
    // Try to load SSL certificate and key
    let httpsOptions = undefined
    const keyPath = path.resolve(config.ssl_key)
    const certPath = path.resolve(config.ssl_cert)
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        httpsOptions = {
            http2: true,
            https: {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath),
            },
        }
    }

    // Create Fastify instance with logging and HTTPS options
    const server = Fastify({
        logger: {
            transport: {
                target: 'pino-pretty',
                options: {
                    ignore: 'pid,hostname',
                    translateTime: 'HH:MM:ss Z',
                },
            },
            level: 'debug',
        },
        ...httpsOptions,
    })

    // Security headers
    const policies = [
        "default-src 'self'",
        "img-src 'self' data:",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
    ]
    server.addHook('onSend', async (req, reply, payload) => {
        reply.header('X-Content-Type-Options', 'nosniff')
        reply.header('X-Frame-Options', 'DENY')
        reply.header('Referrer-Policy', 'no-referrer')
        reply.header('Content-Security-Policy', policies.join('; '))
        return payload
    })

    if (!httpsOptions) {
        server.log.warn('Running WITHOUT HTTPS')
    }

    // Register CORS and compression middleware
    server.register(cors, { origin: config.origin })
    server.register(import('@fastify/compress'))

    // Web routes
    for (const [routePrefix, webRoot] of Object.entries(config.web_roots)) {
        const prefix = routePrefix.endsWith('/') ? routePrefix : routePrefix + '/' 
        server.get(`${prefix}*`, webHandler.run(webRoot))
    }

    // API routes
    for (const [routePrefix, apiRoot] of Object.entries(config.api_roots)) {
        const prefix = routePrefix.endsWith('/') ? routePrefix : routePrefix + '/' 
        server.get(`${prefix}*`, apiHandler.run(apiRoot))
    }
    // Start listening for requests
    await server.listen({ host: config.host, port: config.port })
    return server
}


const startServer = async () => {
    try {
        const config = loadConfig()
        await createServer(config)
    } catch (err) {
        console.error('Failed to start server:', err)
        process.exit(1)
    }
}

// Main entry point: load configuration and start the server

startServer()
