import fs, { createReadStream } from 'fs'
import path from 'path'

import { pathFinder } from './pathFinder.mjs'

const fillTemplate = async (htmlPath, webroot, parts) => {
    let content = await fs.promises.readFile(htmlPath, 'utf-8')
    const includeRegex = /<!--\s*#include\s+virtual\s*=\s*["']([^"']+)["']\s*-->/g

    console.log(`Processing HTML: ${htmlPath} with ${parts.length} part(s)`) // --- IGNORE ---

    let match
    const includes = []
    while ((match = includeRegex.exec(content)) !== null) {
        includes.push(match[1])
    }

    // console.log(`Found ${includes.length} include(s) in ${htmlPath}:`, includes)

    for (let includePath of includes) {
        try {
            let absoluteIncludePath
            if (!includePath.startsWith('/')) {
                const folder = path.dirname(htmlPath)
                const localPath = path.posix.join('/', path.relative(webroot, folder), includePath)
                absoluteIncludePath = pathFinder.getRealPath(webroot, localPath)
            } else {
                absoluteIncludePath = pathFinder.getRealPath(webroot, includePath)
            }

            if (!absoluteIncludePath) {
                console.warn(`Skipping include with invalid path: ${includePath} in ${htmlPath}`)
                continue
            }

            // console.log(`Processing include: ${includePath} in ${htmlPath} (resolved to ${absoluteIncludePath})`)
            const stats = await fs.promises.stat(absoluteIncludePath)
            if (!stats.isFile()) {
                console.warn(`Skipping include that is not a file: ${includePath} in ${htmlPath}`)
                continue
            }

            const includedContent = await fs.promises.readFile(absoluteIncludePath, 'utf-8')

            const escapedPath = includePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            content = content.replace(new RegExp(`<!--\\s*#include\\s*virtual\\s*=\\s*["']${escapedPath}["']\\s*-->`, 'g'), includedContent)
        } catch (err) {
            // Skip includes that cannot be read
            console.warn(`Skipping include due to error: ${includePath} in ${htmlPath}`, err)
            continue
        }
    }

    return content
}

const templateHandler = {
    fillTemplate: fillTemplate
}

export { templateHandler }

