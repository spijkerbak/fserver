import { error } from 'console'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

const getSafeWebXModulePath = (request, webxroot, item) => {
    const normalizedItem = path.posix.normalize(`/${item || ''}`).replace(/^\/+/, '')
    const modulePath = path.resolve(webxroot, normalizedItem, 'run.mjs')
    const relativeToWebXroot = path.relative(webxroot, modulePath)
    if (relativeToWebXroot.startsWith('..') || path.isAbsolute(relativeToWebXroot)) {
        return null
    }
    return modulePath
}

const webxError = (request, reply, status, message) => {
    request.log.warn({ url: request.url, method: request.method, error: error.message }, message)
    return reply.status(status).send({ status: status, message: message })
}


const run = (webxroot) => async (request, reply) => {
    const split = request.url.split('?')
    const queryParams = new URLSearchParams(split[1] || '')
    const url = split[0]
    const parts = url.split('/').filter(Boolean).slice(1) // Remove 'webx' prefix

    let modulePath = getSafeWebXModulePath(request, webxroot, parts.join('/'))
    if (!modulePath || !fs.existsSync(modulePath)) {
        modulePath = getSafeWebXModulePath(request, webxroot, parts.slice(0, -1).join('/'))
        if (!modulePath || !fs.existsSync(modulePath)) {
            modulePath = getSafeWebXModulePath(request, webxroot, parts.slice(0, -2).join('/'))
            if (!modulePath || !fs.existsSync(modulePath)) {
                modulePath = getSafeWebXModulePath(request, webxroot, parts.slice(0, -3).join('/'))
            }
        }
    }
    if (!modulePath || !fs.existsSync(modulePath)) {
        return webxError(request, reply, 404, `Unknown WebX endpoint: ${request.url}`)
    }

    let path
    try {
        path = pathToFileURL(modulePath).href
        const module = await import(path)
        if (typeof module.run === 'function') {
            // reply.header('content-type', 'text/html')
            return await module.run(request, reply, parts)
        }
    } catch (error) {

        return webxError(request, reply, 500, `Failed to execute WebX module: ${request.url}\n${path}\n${error.message}`)
    }

}
const webXHandler = { run }

export { webXHandler }

