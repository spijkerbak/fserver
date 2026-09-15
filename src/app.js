
import Fastify from 'fastify'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { loadConfig } from './config/config.mjs'
import { webHandler } from './handlers/webHandler.mjs'

const createServer = async (config) => {
    // Try to load SSL certificate and key
    let httpsOptions = undefined
    const keyPath = path.resolve(config.ssl.key)
    const certPath = path.resolve(config.ssl.cert)
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
            level: 'warn',
        },
        ...httpsOptions,
    })

    if (!httpsOptions) {
        server.log.error(`Could not read certificate or public key: ${certPath}`)
    }

    // Security headers
    const policies = [
        "default-src 'self'",
        "img-src 'self' data:",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
    ]
    server.addHook('onSend', async (req, reply, payload) => {
        // nosniff lets browser know not to sniff content types,
        // which can prevent some XSS attacks.
        // However, it can cause issues with certain file types 
        // if the server doesn't set the correct Content-Type header.
        // If you want to enable it, make sure your server is correctly setting Content-Type for all responses.
        // Specially with 404 responses, which might be served as text/html by default, causing browsers to try to render them as HTML.

        // reply.header('X-Content-Type-Options', 'nosniff')

        reply.header('X-Frame-Options', 'DENY')
        reply.header('Referrer-Policy', 'no-referrer')
        // reply.header('Content-Security-Policy', policies.join('; '))
        return payload
    })

    if (!httpsOptions) {
        server.log.warn('Running WITHOUT HTTPS')
    }

    // Register CORS and compression middleware
    server.register(cors, { origin: config.origin })
    server.register(import('@fastify/compress'))


    // add routes
    for (const [routePrefix, def] of Object.entries(config.roots || {})) {
        const { path, methods } = def
        for (const method of methods) {
            console.log(`Registering route: ${method} ${routePrefix} -> ${path}`)
            if (method === 'GET') {
                server.get(`${routePrefix}`, webHandler.run(path))
            }
            if (method === 'POST') {
                server.post(`${routePrefix}`, webHandler.run(path))
            }
            if (method === 'PUT') {
                server.put(`${routePrefix}`, webHandler.run(path))
            }
            if (method === 'DELETE') {
                server.delete(`${routePrefix}`, webHandler.run(path))
            }
        }
    }

    // Run initialization
    if (config.init) {
        const initModule = await import(config.init)
        if (typeof initModule.default === 'function') {
            await initModule.default(server, config)
        }
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
