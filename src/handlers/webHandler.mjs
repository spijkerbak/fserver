import fs, { createReadStream } from 'fs'
import path from 'path'
import mime from 'mime-types'
import sharp from 'sharp'

import { pathFinder } from './pathFinder.mjs'
import { templateHandler } from './templateHandler.mjs'

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

async function handleDirectory(request, reply, prep) {

    if (prep.parts.length === 0 && !prep.requestUrl.pathname.endsWith('/')) {
        return reply.redirect(buildRedirectTarget(`${prep.requestUrl.pathname}/`, prep.requestUrl.search))
    }

    console.log(1)
    
    let indexPath = path.join(prep.realPath, 'index.html')
    console.log(2)
    if (await exists(indexPath)) {
        try {
    console.log(3)
            const content = await templateHandler.fillTemplate(indexPath, prep.webroot, prep.parts)
            return reply.type('text/html').send(content)
        } catch (err) {
            request.log.error(err)
            return reply.code(500).send({ error: 'Stream error' })
        }
    }
    indexPath = path.join(prep.realPath, 'run.mjs')
    if (await exists(indexPath)) {
        try {

            const module = await import(indexPath)
            if (typeof module.run === 'function') {
                return await module.run(request, reply, prep.realPath, prep.parts, handleImage)
            }
    console.log(4)
            return reply.code(403).send({ error: 'Forbidden' })
        }
        catch (err) {
            request.log.error(err)
            return reply.code(500).send({ error: 'Import error' })
        }
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
    try {
        if (isHtml(prep.realPath)) {
            const content = await templateHandler.fillTemplate(prep.realPath, prep.webroot, prep.parts ?? [])
            return reply.type('text/html').send(content)
        }

        const stream = createReadStream(prep.realPath)
        stream.on('error', err => {
            request.log.error(err)
            if (!reply.sent) {
                reply.code(500).send({ error: 'Stream error' })
            }
        })

        return reply.type(getContentType(prep.realPath)).send(stream)

    } catch (err) {
        request.log.error(err)
        return reply.code(500).send({ error: 'Stream error' })
    }
}

async function handleImage(request, reply, prep) {

    console.log(`Handling image request for ${prep.realPath} with query:`, request.query)

    const sizes = [100, 200, 400, 800, 1200, 1600, 2000, 3000, 4000]
    const requestedWidth = parseInt(request.query.width, 10)

    // If no valid width is requested, serve the original image
    if (isNaN(requestedWidth) || requestedWidth <= 0) {
        return handleFile(request, reply, prep)
    }
    const closestSize = sizes.find(size => size >= requestedWidth) || sizes[sizes.length - 1]
    const dir = path.dirname(prep.realPath)
    const filename = path.basename(prep.realPath)
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
            request.log.debug(`Resizing image ${prep.realPath} to width ${closestSize}px (requested: ${requestedWidth}px)`)
            await sharp(prep.realPath).resize({ width: closestSize }).toFile(resizedImagePath)
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
        console.log(`Resolved path for request "${request.url}":`, {
            decodedPath,
            realPath,
            pathExists,
            parts
        })
        if (!pathExists) {
            return reply.code(404).send({ error: `File not found (1) (${realPath})` })
        }   
        const stats = await fs.promises.stat(realPath)

        const prep = {
            hostname: hostname,
            decodedPath: decodedPath,
            realPath: realPath,
            requestUrl: requestUrl,
            webroot: webroot,
            parts: parts,
        }

        console.log(`Handling request for ${realPath} with prep:`, prep)

        prep.stats = stats


        if (stats.isDirectory()) {
            console.log(`Handling directory request for ${realPath} with parts:`, parts)
            return await handleDirectory(request, reply, prep)
        }
        if (!stats.isFile()) {
            return reply.code(404).send({ error: 'File not found (2)' })
        }
        if (!isAllowed(realPath)) {
            return reply.code(403).send({ error: 'Forbidden' })
        }
        if (request.headers.range) {
            return handleRange(request, reply, prep)
        }
        if (isImage(realPath)) {
            return await handleImage(request, reply, prep)
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