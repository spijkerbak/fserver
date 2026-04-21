import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const default_config = {
    origin: ['http://localhost'],
    host: '0.0.0.0',
    port: 3000,
    web_roots: {
        "/": "public/web"
    },
    api_roots: {
        "/api": "public/api"
    },
    ssl_key: 'ssl/key.pem',
    ssl_cert: 'ssl/cert.pem',
}

const configPath = path.join(__dirname, '../../' , 'config.json')

export function loadConfig() {
    let config = {}
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
        const keys = Object.keys(default_config)
        for (const key of keys) {
            if (!config[key]) {
                config[key] = default_config[key]
            }
        }
        console.log('Config: ', JSON.stringify(config, null, 2))
    } catch (err) {
        console.warn('Warning: config.json cannot be read, using defaults')
        // config = { ...default_config }
        config = default_config
    }

    return config
}
