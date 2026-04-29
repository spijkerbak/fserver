import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const getSafeApiModulePath = (request, apiroot, item) => {
    const normalizedItem = path.posix.normalize(`/${item || ''}`).replace(/^\/+/, '')
    const modulePath = path.resolve(apiroot, normalizedItem, 'run.mjs')
    const relativeToApiroot = path.relative(apiroot, modulePath)
    if (relativeToApiroot.startsWith('..') || path.isAbsolute(relativeToApiroot)) {
        return null
    }
    return modulePath
}

const run = (apiroot) => async (request, reply) => {
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
                modulePath = getSafeApiModulePath(request, apiroot, parts.slice(0, -3).join('/'))
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
        const module = await import(pathToFileURL(modulePath).href)
        if (typeof module.run === 'function') {
            return await module.run(request, reply)
        }
    } catch (error) {
        request.log.error({ path: modulePath, error }, 'Failed to execute API module (2)')
        return reply.status(500).send({ message: 'Internal server error' })
    }

}
const apiHandler = { run }

export { apiHandler }