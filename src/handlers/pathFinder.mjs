import path from 'path'

/**
 * Safely resolves a requested path against a webroot directory, 
 * ensuring the resolved path does not escape the webroot.
 * @param {string} webroot - The root directory to resolve paths against
 * @param {string} requestPath - The requested path to resolve
 * @returns {string | null} The absolute path, or null if path escapes webroot
 */

const getRealPath = (webroot, requestPath) => {
    const normalizedPath = path.posix.normalize(`/${requestPath || ''}`)
    const relativePath = normalizedPath.replace(/^\/+/, '')
    const absolutePath = path.resolve(webroot, relativePath)
    const relativeToWebroot = path.relative(webroot, absolutePath)

    if (relativeToWebroot.startsWith('..') || path.isAbsolute(relativeToWebroot)) {
        return null
    }

    return absolutePath
}

const pathFinder = {
    getRealPath: getRealPath
}

export { pathFinder }

