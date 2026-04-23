import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const getSafeApiModulePath = (request, apiroot, item) => {
    const normalizedItem = path.posix.normalize(`/${item || ''}`).replace(/^\/+/, '')
    request.log.error(`Normalized API path: ${normalizedItem}`)
    const modulePath = path.resolve(apiroot, normalizedItem, 'run.mjs')
    request.log.error(`Resolved API module path: ${modulePath}`)
    const relativeToApiroot = path.relative(apiroot, modulePath)
    if (relativeToApiroot.startsWith('..') || path.isAbsolute(relativeToApiroot)) {
        return null
    }
    request.log.error(`Resolved API module path: ${modulePath}`)
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
    request.log.error(`API root: ${apiroot}`)
    request.log.error(`Handling API request: ${request.url} with method: ${request.method}`)


    const split = request.url.split('?')
    const queryParams = new URLSearchParams(split[1] || '')
    const url = split[0]
    const parts = url.split('/').filter(Boolean).slice(1) // Remove 'api' prefix

    let modulePath = getSafeApiModulePath(request, apiroot, parts.join('/'))
    if (!modulePath || !fs.existsSync(modulePath)) {
        modulePath = getSafeApiModulePath(request, apiroot, parts.slice(0, -1).join('/'))
        if (!modulePath || !fs.existsSync(modulePath)) {
            modulePath = getSafeApiModulePath(request, apiroot, parts.slice(0, -2).join('/'))
            if (!modulePath || !fs.existsSync(modulePath)) {
                modulePath = getSafeApiModulePath(request,apiroot, parts.slice(0, -3).join('/'))
            }
        }
    }
    if (!modulePath || !fs.existsSync(modulePath)) {
        // const errorMessage = `API module not found for path: ${request.url} => ${modulePath || 'N/A'}`
        const errorMessage = `API module not found for path: ${parts} => ${modulePath || 'N/A'}`
        request.log.warn({ url: request.url, method: request.method }, errorMessage)
        return reply.status(400).send({ message: errorMessage })
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