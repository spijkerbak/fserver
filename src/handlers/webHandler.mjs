import fs, { createReadStream } from 'fs'
import path from 'path'
import mime from 'mime-types'
import sharp from 'sharp'

import { pathFinder } from './pathFinder.mjs'
import { templateHandler } from './templateHandler.mjs'

// ---- White list of allowed file types (security!) ----
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg', '.gif', '.tiff', '.bmp', '.webp']
const VIDEO_EXT = ['.mp4', '.webm', '.ogg', '.mkv', '.avi', '.mov', '.m4v']
const AUDIO_EXT = ['.mp3', '.wav', '.ogg']
const DOC_EXT = ['.pdf', '.docx', '.xlsx', '.pptx']
const WEB_EXT = ['.html', '.css', '.js']
const SSI_EXT = ['.html', '.part', '.inc', '.txt', '.phtml'] // for server side includes
const ALLOWED_EXT = [...WEB_EXT, ...DOC_EXT, ...IMAGE_EXT, ...VIDEO_EXT, ...AUDIO_EXT, ...SSI_EXT]

function isAllowed(file) {
    return ALLOWED_EXT.includes(path.extname(file).toLowerCase())
}

function isImage(file) {
    return IMAGE_EXT.includes(path.extname(file).toLowerCase())
}

function isAudio(file) {
    return AUDIO_EXT.includes(path.extname(file).toLowerCase())
}

function isVideo(file) {
    return VIDEO_EXT.includes(path.extname(file).toLowerCase())
}

function isHtml(file) {
    return path.extname(file).toLowerCase() === '.html'
}

const getContentType = (filePath) => {
    const extension = path.extname(filePath).toLowerCase()
    const type = mime.lookup(extension) || 'application/octet-stream'
    return type
}

const buildRedirectTarget = (pathname, search = '') => {
    if (!pathname || pathname === '/') {
        return `/${search}`
    }
    return `${pathname}${search}`
}

async function handleData(request, reply, prep, mimeType, content) {
    if (content) {
        return reply.type(mimeType).send(content)
    } else {
        if (mimeType === 'text/html') {
            return handleFile(request, reply, prep)
        }
        if (mimeType.startsWith('image/')) {
            return await handleImage(request, reply, prep)
        }
        if (mimeType.startsWith('video/')) {
            return await handleFile(request, reply, prep)
        }
        return reply.type('text/plain').send('No content available for mimetype: ' + mimeType)
    }
}

/**
 * Handles execution of run.mjs module in the requested directory
 * @param {*} request - The HTTP request object
 * @param {*} reply - The HTTP reply object
 * @param {*} prep - The prepared request data object
 * @returns {Promise} The result of the run module execution or error response
 */
async function handleRuner(request, reply, prep) {
    const runerPath = path.join(prep.realPath, 'run.mjs')
    if (await exists(runerPath)) {
        try {
            const module = await import(runerPath)
            if (typeof module.run === 'function') {
                return await module.run(request, reply, prep, handleData)
            }
            return reply.code(403).send({ error: 'Forbidden' })
        }
        catch (err) {
            request.log.error(err)
            return reply.code(500).send({ error: 'Import error' })
        }
    }
}

/**
 * 
 * @param {*} request 
 * @param {*} reply 
 * @param {*} prep 
 * @returns 
 */
async function handleDirectory(request, reply, prep) {

    if (prep.parts.length === 0 && !prep.requestUrl.pathname.endsWith('/')) {
        return reply.redirect(buildRedirectTarget(`${prep.requestUrl.pathname}/`, prep.requestUrl.search))
    }

    let indexPath = path.join(prep.realPath, 'index.html')
    if (await exists(indexPath)) {
        prep.realPath = indexPath
        prep.stats = await fs.promises.stat(prep.realPath)

        return handleFile(request, reply, prep)
    }
    let runnerPath = path.join(prep.realPath, 'run.mjs')
    if (await exists(runnerPath)) {
        return handleRuner(request, reply, prep)
    }
}

async function handleRange(request, reply, prep) {
    const range = request.headers.range
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end = endStr ? parseInt(endStr, 10) : prep.stats.size - 1

    if (isNaN(start) || isNaN(end) || start < 0 || end >= prep.stats.size || start > end) {
        return reply.code(416).send({ error: 'Invalid Range header' })
    }

    const startpct = ((start / prep.stats.size) * 100).toFixed(2)
    const endpct = ((end / prep.stats.size) * 100).toFixed(2)
    request.log.debug(`Range from ${startpct}% to ${endpct}% for ${prep.realPath}`)

    const chunkSize = (end - start) + 1
    const stream = createReadStream(prep.realPath, { start, end })

    stream.on('error', err => {
        request.log.error(err)
        if (!reply.sent) {
            reply.code(500).send({ error: 'Stream error' })
        }
    })

    reply.code(206)
    reply.header('Content-Range', `bytes ${start}-${end}/${prep.stats.size}`)
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Content-Length', chunkSize)
    return reply.type(getContentType(prep.realPath)).send(stream)
}

async function handleFile(request, reply, prep) {

    console.log(`Handling file request for ${prep.realPath}`)
    // in some cases, realPath may still contain query parameters
    // so parse them and remove them from the realPath if necessary
    let query = {}
    let parts = prep.realPath.split('?')
    if (parts.length > 1) {
        prep.realPath = parts[0]
        prep.stats = await fs.promises.stat(prep.realPath)

        request.log.debug(`Stripped query parameters from realPath: ${prep.realPath}`)
        query = Object.fromEntries(new URLSearchParams(parts[1]))
        console.log(`CORRECTION: file request for ${prep.realPath}`)
        console.log(JSON.stringify(request, null, 2))
    }

    try {
        if (isHtml(prep.realPath)) {
            const content = await templateHandler.fillTemplate(prep.realPath, prep.webroot, query)
            return reply.type('text/html').send(content)
        }

        if (prep.stats.size <= 4096) {
            const start = 0
            const end = Math.min(prep.stats.size, 4096) // Serve first 4KB for range requests
            const chunkSize = (end - start) + 1
            reply.code(206)
            reply.header('Content-Length', chunkSize)
            const chunk = await fs.promises.readFile(prep.realPath, { encoding: null, start, end })
            return reply.type(getContentType(prep.realPath)).send(chunk)
        } else {
            const start = 0
            const end = Math.min(prep.stats.size, 4096) // Serve first 4KB for range requests
            const chunkSize = (end - start) + 1
            reply.code(206)
            reply.header('Content-Range', `bytes ${start}-${end}/${prep.stats.size}`)
            reply.header('Accept-Ranges', 'bytes')
            reply.header('Content-Length', chunkSize)
            const chunk = await fs.promises.readFile(prep.realPath, { encoding: null, start, end })
            return reply.type(getContentType(prep.realPath)).send(chunk)
        }
    } catch (err) {
        request.log.error(err)
        return reply.code(500).send({ error: 'Stream error' })
    }
}

async function handleImage(request, reply, prep) {

    let msg = `Handling image request for ${prep.realPath}`
    if (request.query) {
        msg += ` with query: ${JSON.stringify(request.query)}`
    }
    console.log(msg)

    const sizes = [100, 200, 400, 800, 1200, 1600, 2000, 3000, 4000]
    const requestedWidth = parseInt(request.query.width, 10) || parseInt(request.query.height, 10)

    // If no valid width is requested, serve the original image
    if (isNaN(requestedWidth) || requestedWidth <= 0) {
        return handleFile(request, reply, prep)
    }
    const closestSize = sizes.find(size => size >= requestedWidth) || sizes[sizes.length - 1]
    const dir = path.dirname(prep.realPath)
    const filename = path.basename(prep.realPath)
    const resizedDir = path.join(dir, '.resized')

    // Ensure the resized directory exists
    await fs.promises.mkdir(resizedDir, { recursive: true, mode: 0o777 })
    await fs.promises.chmod(resizedDir, 0o777)

    const resizedImagePath = path.join(resizedDir, `${filename}.${closestSize}`)

    try {

        // Check if resized image already exists
        try {
            await fs.promises.stat(resizedImagePath)
        } catch {
            // File doesn't exist, create it
            request.log.debug(`Resizing image ${prep.realPath} to width ${closestSize}px (requested: ${requestedWidth}px)`)
            await sharp(prep.realPath).resize({ width: closestSize }).toFile(resizedImagePath)
            await fs.promises.chmod(resizedImagePath, 0o777)
        }

        const stream = createReadStream(resizedImagePath)

        stream.on('error', err => {
            request.log.error(err)
            if (!reply.sent) {
                reply.code(500).send({ error: 'Stream error' })
            }
        })

        const contentType = getContentType(prep.realPath)
        reply.header('Content-Type', contentType)
        return reply.send(stream)
    } catch (err) {
        request.log.error(err)
        return reply.code(500).send({ error: 'Image processing error' })
    }
}

function exists(path) {
    return fs.promises.access(path, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false)
}

const run = (webroot) => async (request, reply) => {

    const wildcardPath = request.params['*'] ?? ''
    const hostname = request.headers.host || request.headers[':authority'] || 'localhost'
    const requestUrl = new URL(request.url, `https://${hostname}`)

    let decodedPath

    try {
        decodedPath = decodeURIComponent(wildcardPath)
    } catch {
        return reply.code(400).send({ error: 'Invalid path' })
    }

    if (decodedPath.endsWith('/index.html') || decodedPath === 'index.html') {
        const redirectPath = decodedPath === 'index.html'
            ? '/'
            : `/${decodedPath.slice(0, -'index.html'.length)}`

        return reply.redirect(buildRedirectTarget(redirectPath, requestUrl.search))
    }

    let realPath = pathFinder.getRealPath(webroot, decodedPath)

    if (!realPath) {
        return reply.code(404).send({ error: 'File not found (0)' })
    }

    try {
        let pathExists = await exists(realPath)
        let parts = []
        if (!pathExists) {
            realPath = pathFinder.getRealPath(webroot, `${decodedPath}/../`)
            parts = decodedPath.split('/').filter(Boolean).slice(-1)
            pathExists = await exists(realPath)
        }
        if (!pathExists) {
            realPath = pathFinder.getRealPath(webroot, `${decodedPath}/../../`)
            parts = decodedPath.split('/').filter(Boolean).slice(-2)
            pathExists = await exists(realPath)
        }
        if (!pathExists) {
            realPath = pathFinder.getRealPath(webroot, `${decodedPath}/../../../`)
            parts = decodedPath.split('/').filter(Boolean).slice(-3)
            pathExists = await exists(realPath)
        }
        if (!pathExists) {
            return reply.code(404).send({ error: `File not found (1) (${realPath})` })
        }

        const prep = {
            hostname: hostname,
            decodedPath: decodedPath,
            realPath: realPath,
            requestUrl: requestUrl,
            webroot: webroot,
            parts: parts,
            stats: null
        }
        prep.stats = await fs.promises.stat(realPath)

        if (prep.stats.isDirectory()) {
            console.log(`Handling directory request for ${prep.realPath} with parts:`, prep.parts)
            return await handleDirectory(request, reply, prep)
        }
        if (!prep.stats.isFile()) {
            return reply.code(404).send({ error: 'File not found (2)' })
        }
        if (!isAllowed(realPath)) {
            return reply.code(403).send({ error: 'Forbidden' })
        }
        if (isImage(realPath)) {
            return await handleImage(request, reply, prep)
        }
        if (request.headers.range) {
            console.log(`RANGE REQUEST for ${realPath} with range: ${request.headers.range}`)
            return handleRange(request, reply, prep)
        }
        return await handleFile(request, reply, prep)

    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`File not found: ${realPath}`)
            return reply.code(404).send({ error: `File not found (3) (${realPath})` })
        }
        return reply.code(500).send({ error: 'Internal Server Error (1)' })
    }
}

const webHandler = { run }

export { webHandler }