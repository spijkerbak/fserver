import fs, { createReadStream } from 'fs'
import path from 'path'
import mime from 'mime-types'
import sharp from 'sharp'

import { pathFinder } from './pathFinder.mjs'
import { webHtmlHandler } from './webHtmlHandler.mjs'

// ---- White list of allowed file types (security!) ----
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.svg']
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

async function handleDirectory(request, reply, absolutePath, requestUrl, webroot, parts) {

    if (parts.length === 0 && !requestUrl.pathname.endsWith('/')) {
        return reply.redirect(buildRedirectTarget(`${requestUrl.pathname}/`, requestUrl.search))
    }

    let indexPath = path.join(absolutePath, 'index.html')
    if (await exists(indexPath)) {
        try {
            const content = await webHtmlHandler.handleHtml(indexPath, webroot, parts)
            return reply.type('text/html').send(content)
        } catch (err) {
            request.log.error(err)
            return reply.code(500).send({ error: 'Stream error' })
        }
    }
    indexPath = path.join(absolutePath, 'run.mjs')
    if (await exists(indexPath)) {
        try {

            const module = await import(indexPath)
            if (typeof module.run === 'function') {
                return await module.run(request, reply, absolutePath, parts, handleImage)
            }
            return reply.code(403).send({ error: 'Forbidden' })
        }
        catch (err) {
            request.log.error(err)
            return reply.code(500).send({ error: 'Import error' })
        }
    }
}

async function handleRange(request, reply, absolutePath, stats) {
    const range = request.headers.range
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
    const start = parseInt(startStr, 10)
    const end = endStr ? parseInt(endStr, 10) : stats.size - 1

    if (isNaN(start) || isNaN(end) || start < 0 || end >= stats.size || start > end) {
        return reply.code(416).send({ error: 'Invalid Range header' })
    }

    const startpct = ((start / stats.size) * 100).toFixed(2)
    const endpct = ((end / stats.size) * 100).toFixed(2)
    request.log.debug(`Range from ${startpct}% to ${endpct}% for ${absolutePath}`)

    const chunkSize = (end - start) + 1
    const stream = createReadStream(absolutePath, { start, end })

    stream.on('error', err => {
        request.log.error(err)
        if (!reply.sent) {
            reply.code(500).send({ error: 'Stream error' })
        }
    })

    reply.code(206)
    reply.header('Content-Range', `bytes ${start}-${end}/${stats.size}`)
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Content-Length', chunkSize)
    return reply.type(getContentType(absolutePath)).send(stream)
}

async function handleFile(request, reply, absolutePath, webroot, parts) {
    try {
        if (isHtml(absolutePath)) {
            const content = await webHtmlHandler.handleHtml(absolutePath, webroot, parts ?? [])
            return reply.type('text/html').send(content)
        }

        const stream = createReadStream(absolutePath)
        stream.on('error', err => {
            request.log.error(err)
            if (!reply.sent) {
                reply.code(500).send({ error: 'Stream error' })
            }
        })

        return reply.type(getContentType(absolutePath)).send(stream)

    } catch (err) {
        request.log.error(err)
        return reply.code(500).send({ error: 'Stream error' })
    }
}

async function handleImage(request, reply, absolutePath) {

    console.log(`Handling image request for ${absolutePath} with query:`, request.query)

    const sizes = [100, 200, 400, 800, 1200, 1600, 2000, 3000, 4000]
    const requestedWidth = parseInt(request.query.width, 10)


    // If no valid width is requested, serve the original image
    if (isNaN(requestedWidth) || requestedWidth <= 0) {
        return handleFile(request, reply, absolutePath)
    }
    const closestSize = sizes.find(size => size >= requestedWidth) || sizes[sizes.length - 1]
    const dir = path.dirname(absolutePath)
    const filename = path.basename(absolutePath)
    const resizedDir = path.join(dir, '.resized')

    // Ensure the resized directory exists
    await fs.promises.mkdir(resizedDir, { recursive: true })
    const resizedImagePath = path.join(resizedDir, `${filename}.${closestSize}`)

    try {

        // Check if resized image already exists
        try {
            await fs.promises.stat(resizedImagePath)
        } catch {
            // File doesn't exist, create it
            request.log.debug(`Resizing image ${absolutePath} to width ${closestSize}px (requested: ${requestedWidth}px)`)
            await sharp(absolutePath).resize({ width: closestSize }).toFile(resizedImagePath)
        }

        const stream = createReadStream(resizedImagePath)

        stream.on('error', err => {
            request.log.error(err)
            if (!reply.sent) {
                reply.code(500).send({ error: 'Stream error' })
            }
        })

        const contentType = getContentType(resolvedPath.absolutePath)
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
    const requestUrl = new URL(request.url, `http://${request.headers.host}`)

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

    let absolutePath = pathFinder.getAbsolutePath(webroot, decodedPath)

    if (!absolutePath) {
        return reply.code(404).send({ error: 'File not found (0)' })
    }

    try {
        let pathExists = await exists(absolutePath)
        let parts = []
        if (!pathExists) {
            absolutePath = pathFinder.getAbsolutePath(webroot, `${decodedPath}/../`)
            parts = decodedPath.split('/').filter(Boolean).slice(-1)
            pathExists = await exists(absolutePath)
        }
        if (!pathExists) {
            absolutePath = pathFinder.getAbsolutePath(webroot, `${decodedPath}/../../`)
            parts = decodedPath.split('/').filter(Boolean).slice(-2)
            pathExists = await exists(absolutePath)
        }
        if (!pathExists) {
            absolutePath = pathFinder.getAbsolutePath(webroot, `${decodedPath}/../../../`)
            parts = decodedPath.split('/').filter(Boolean).slice(-3)
            pathExists = await exists(absolutePath)
        }
        console.log(`Resolved path for request "${request.url}":`, {
            decodedPath,
            absolutePath,
            pathExists,
            parts
        })
        if (!pathExists) {
            return reply.code(404).send({ error: `File not found (1) (${absolutePath})` })
        }
        const stats = await fs.promises.stat(absolutePath)

        if (stats.isDirectory()) {
            console.log(`Handling directory request for ${absolutePath} with parts:`, parts)
            return await handleDirectory(request, reply, absolutePath, requestUrl, webroot, parts)
        }
        if (!stats.isFile()) {
            return reply.code(404).send({ error: 'File not found (2)' })
        }
        if (!isAllowed(absolutePath)) {
            return reply.code(403).send({ error: 'Forbidden' })
        }
        if (request.headers.range) {
            return handleRange(request, reply, absolutePath, stats)
        }
        if (isImage(absolutePath)) {
            return await handleImage(request, reply, absolutePath)
        }
        return await handleFile(request, reply, absolutePath, webroot)

    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`File not found: ${absolutePath}`)
            return reply.code(404).send({ error: `File not found (3) (${absolutePath})` })
        }
        return reply.code(500).send({ error: 'Internal Server Error (1)' })
    }
}

const webHandler = { run }

export { webHandler }