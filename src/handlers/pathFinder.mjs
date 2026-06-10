import path from 'path'

/**
 * Safely resolves a requested path against a webroot directory, 
 * ensuring the resolved path does not escape the webroot.
 * @param {string} webroot - The root directory to resolve paths against
 * @param {string} requestPath - The requested path to resolve
 * @returns {{ absolutePath: string, relativePath: string } | null} Object with absolute and relative paths, or null if path escapes webroot
 */
const getSafeWebrootPath = (webroot, requestPath) => {
    const normalizedPath = path.posix.normalize(`/${requestPath || ''}`)
    const relativePath = normalizedPath.replace(/^\/+/, '')
    const absolutePath = path.resolve(webroot, relativePath)
    const relativeToWebroot = path.relative(webroot, absolutePath)

    if (relativeToWebroot.startsWith('..') || path.isAbsolute(relativeToWebroot)) {
        return null
    }

    return {
        absolutePath,
        relativePath,
    }
}

const pathFinder = {
    getSafeWebrootPath: getSafeWebrootPath
}

export { pathFinder }

