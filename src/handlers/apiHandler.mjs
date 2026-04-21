import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const getSafeApiModulePath = (apiroot, item) => {
    const normalizedItem = path.posix.normalize(`/${item || ''}`).replace(/^\/+/, '')
    const modulePath = path.resolve(apiroot, normalizedItem, 'run.mjs')
    const relativeToApiroot = path.relative(apiroot, modulePath)
    if (relativeToApiroot.startsWith('..') || path.isAbsolute(relativeToApiroot)) {
        return null
    }
    return modulePath
}

const runModule = async (modulePath, request, reply) => {
    try {
        const module = await import(pathToFileURL(modulePath).href)
        if (typeof module.run === 'function') {
            return await module.run(request, reply)
        } else {
            throw new Error('Module does not export a run function')
        }
    } catch (error) {
        throw new Error(`Failed to execute API module: ${error.message}`)
    }
}

const run = (apiroot) => async (request, reply) => {

    const split = request.url.split('?')
    const queryParams = new URLSearchParams(split[1] || '')
    const url = split[0]
    const parts = url.split('/').filter(Boolean).slice(1) // Remove 'api' prefix

    let modulePath = getSafeApiModulePath(apiroot, parts.join('/'))
    if (!modulePath || !fs.existsSync(modulePath)) {
        modulePath = getSafeApiModulePath(apiroot, parts.slice(0, -1).join('/'))
        if (!modulePath || !fs.existsSync(modulePath)) {
            modulePath = getSafeApiModulePath(apiroot, parts.slice(0, -2).join('/'))
            if (!modulePath || !fs.existsSync(modulePath)) {
                modulePath = getSafeApiModulePath(apiroot, parts.slice(0, -3).join('/'))
            }
        }
    }
    if (!modulePath || !fs.existsSync(modulePath)) {
        request.log.warn({ url: request.url, method: request.method }, 'Invalid API path')
        return reply.status(400).send({ message: 'Invalid API path' })
    }

    try {
        return await runModule(modulePath, request, reply)
    } catch (error) {
        request.log.error({ path: modulePath, error }, 'Failed to execute API module')
        return reply.status(500).send({ message: 'Internal server error' })
    }

}
const apiHandler = { run }

export { apiHandler }