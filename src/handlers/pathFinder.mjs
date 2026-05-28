import path from 'path'

const getSafeWebrootPath = (webroot, requestPath) => {
    const normalizedPath = path.posix.normalize(`/${requestPath || ''}`)
    const relativePath = normalizedPath.replace(/^\/+/, '')
    const absolutePath = path.resolve(webroot, relativePath)
    const relativeToWebroot = path.relative(webroot, absolutePath)

    // console.log({
    //     webroot: webroot,
    //     requestPath: requestPath,
    //     normalizedPath: normalizedPath,
    //     relativePath: relativePath,
    //     absolutePath: absolutePath,
    //     relativeToWebroot: relativeToWebroot,
    // })

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

