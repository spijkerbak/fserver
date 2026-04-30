import { error } from 'console'
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

const apiError = (request, reply, status, message) => {
    request.log.warn({ url: request.url, method: request.method, error: error.message }, message)
    return reply.status(status).send({ status: status, message: message })
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
        return apiError(request, reply, 404, `Unknown API endpoint: ${request.url}`)
    }

    try {
        const module = await import(pathToFileURL(modulePath).href)
        if (typeof module.run === 'function') {
            return await module.run(request, reply)
        }
    } catch (error) {
        return apiError(request, reply, 500, `Failed to execute API module: ${request.url}`)
    }

}
const apiHandler = { run }

export { apiHandler }