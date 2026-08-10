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

function isJson(file) {
    return path.extname(file).toLowerCase() === '.json'
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

async function handleData(request, reply, prep, contentType, content) {
    if (content) {
        return reply.type(contentType).send(content)
    } else {
        if (contentType === 'text/html') {
            return handleFile(request, reply, prep)
        }
        if (contentType.startsWith('image/')) {
            return await handleImage(request, reply, prep)
        }
        if (contentType.startsWith('video/')) {
            return await handleFile(request, reply, prep)
        }
        return reply.type('text/plain').send('No content available for content-type: ' + contentType)
    }
}

async function handleRunner(request, reply, prep) {
    const runnerPath = prep.realPath
    try {
        const module = await import(runnerPath)
        if (typeof module.run === 'function') {
            return await module.run(request, reply, prep, handleData)
        }
        return reply.code(403).send({ error: 'Forbidden (79)' })
    }
    catch (err) {
        request.log.error(err)
        return reply.code(500).send({ error: 'Error running api (83)', message: err.message })
    }
}

/**
 * 
 * @param {*} request 
 * @param {*} reply 
 * @param {*} prep 
 * @returns {Promise} The result of the directory handling or error response
 */
async function handleDirectory(request, reply, prep) {

    if (prep.tail.length === 0 && !prep.requestUrl.pathname.endsWith('/')) {
        return reply.redirect(buildRedirectTarget(`${prep.requestUrl.pathname}/`, prep.requestUrl.search))
    }

    let indexPath = path.join(prep.realPath, 'index.html')
    if (await exists(indexPath)) {
        prep.setRealPath(indexPath, 1)
        return await handleFile(request, reply, prep)
    }
    let runnerPath = path.join(prep.realPath, 'run.mjs')
    if (await exists(runnerPath)) {
        return await handleRunner(request, reply, prep)
    }
}

async function handleFile(request, reply, prep) {

    // in some cases, realPath may still contain query parameters
    // so parse them and remove them from the realPath if necessary
    let query = {}
    let parts = prep.realPath.split('?')
    if (parts.length > 1) {
        prep.setRealPath(parts[0], 2)
        query = Object.fromEntries(new URLSearchParams(parts[1]))
    }

    const new_range = request.headers.range || ''
    const [startStr, endStr] = new_range.replace(/bytes=/, '').split('-')
    const new_start = startStr ? parseInt(startStr, 10) : 0
    const new_end = endStr ? parseInt(endStr, 10) : prep.filesize - 1


    try {
        console.log(`contentType: ${prep.contentType}, filesize: ${prep.filesize}, realPath: ${prep.realPath}`)
        if (prep.contentType == 'text/html') {
            const content = await templateHandler.fillTemplate(prep.realPath, prep.webroot, query)
            return reply.type(prep.contentType).send(content)
        }
        if (prep.contentType.startsWith('text/') || prep.contentType.startsWith('application/')) {
            const content = await fs.promises.readFile(prep.realPath, 'utf-8')
            return reply.type(prep.contentType).send(content)
        }

        const fileSize = prep.filesize
        const start = new_start
        const end = new_end
        const chunkSize = fileSize - start
        console.log(`Path: ${prep.realPath}`)
        reply.code(206)
        reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
        reply.header('Accept-Ranges', 'bytes')
        const stream = createReadStream(prep.realPath, { start, end })
        stream.on('error', err => {
            request.log.error(err)
            if (!reply.sent) {
                reply.code(500).send({ error: 'Stream error' })
            }
        })
        reply.header('Content-Length', chunkSize)
        return reply.type(prep.contentType).send(stream)
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

        reply.header('Content-Type', prep.contentType)
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

function getStats(realPath) {
    return fs.statSync(realPath, { throwIfNoEntry: false }) || null
}

function makePrep(webroot, request) {
    const hostname = request.headers.host || request.headers[':authority'] || 'localhost'
    const requestPath = request.params['*'] ?? ''
    const realPath = pathFinder.getRealPath(webroot, requestPath)
    // const stats = getStats(realPath)

    let prep = {
        hostname: hostname,
        webroot: webroot,
        requestPath: requestPath,
        query: request.query ?? {},
        webroot: webroot,
        realPath: null,
        filesize: 0,
        type: 'UNKNOWN',
        contentType: '',
        tail: [],
        message: '200 OK',
        setRealPath: function (newPath, pos = 222) {
            this.realPath = newPath
            const stats = getStats(this.realPath)
            if (stats) {
                this.type = stats.isFile() ? 'FILE' : stats.isDirectory() ? 'DIRECTORY' : 'OTHER'
                if (this.type === 'FILE') {
                    this.filesize = stats.size
                    this.contentType = getContentType(this.realPath)
                }
            } else {
                this.type = 'NOTFOUND'
                this.filesize = 0
            }
        },
        setRealPathFile: function (filename, pos = 333) {
            let directory = this.type == 'DIRECTORY' ? this.realPath : path.dirname(this.realPath)
            this.setRealPath(path.join(directory, filename), pos + 100)
        }
    }
    prep.setRealPath(realPath, 5)
    return prep
}

function dumpPrep(request, reply, prep) {
    return reply.code(200).header('Content-Type', 'text/html').send(`<!DOCTYPE html>
<html>
    <head>
        <meta charset="UTF-8">
        <title>Request</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; }
            th { background-color: #f2f2f2; text-align: left; }
        </style>
    </head>
    <body>
        <h1>Request</h1>
        <table border="1">
            <tr><td>Hostname</td><td>${prep.hostname}</td></tr> 
            <tr><td>Webroot</td><td>${prep.webroot}</td></tr>
            <tr><td>Request Path</td><td>${prep.requestPath}</td></tr>
            <tr><td>Query</td><td>${JSON.stringify(prep.query)}</td></tr>
            <tr><td>Real Path</td><td>${prep.realPath}</td></tr>
            <tr><td>Type</td><td>${prep.type}</td></tr>
            <tr><td>Filesize</td><td>${prep.filesize}</td></tr>
            <tr><td>Content Type</td><td>${prep.contentType}</td></tr>
            <tr><td>Tail</td><td>${prep.tail.join(' / ')}</td></tr>
            <tr><td>Message</td><td>${prep.message}</td></tr>
        </table>
    </body>
</html>`)
}


const run = (webroot) => async (request, reply) => {
    const hostname = request.headers.host || request.headers[':authority'] || 'localhost'
    const requestPath = request.params['*'] ?? ''

    let prep = makePrep(webroot, request)

    const dump = false // set to true to dump prep for debugging

    while (prep.type == 'NOTFOUND') {
        prep.tail.unshift(path.basename(prep.realPath))
        prep.setRealPath(path.dirname(prep.realPath), 6)
    }

    if (prep.type === 'OTHER') {
        prep.message = '404 Not a valid file or directory'
        if (dump) return dumpPrep(request, reply, prep)
        return reply.code(404).send({ error: 'Not found' })
    }

    if (prep.type === 'DIRECTORY') {
        prep.setRealPathFile('index.html', 7)
        if (prep.type === 'FILE') {
            if (prep.tail.length > 0) {
                prep.message = '404 index.html with tail not allowed'
                if (dump) return dumpPrep(request, reply, prep)
                return reply.code(404).send({ error: 'Not found!' })
            }
            if (dump) return dumpPrep(request, reply, prep)
            return await handleFile(request, reply, prep)
        } else {
            prep.setRealPathFile('run.mjs', 8)
            if (prep.type !== 'FILE') {
                prep.message = '404 Not found'
                if (dump) return dumpPrep(request, reply, prep)
                return reply.code(404).send({ error: 'Not found' })
            }
            if (dump) return dumpPrep(request, reply, prep)
            return handleRunner(request, reply, prep)
        }
        prep.message = '404 Directory not allowed'
        if (dump) return dumpPrep(request, reply, prep)
        return reply.code(404).send({ error: 'Not found' })
    }

    if (prep.type === 'FILE') {
        if (prep.tail.length > 0) {
            prep.message = '404 file with tail not allowed'
            if (dump) return dumpPrep(request, reply, prep)
            return reply.code(404).send({ error: 'Not found!' })
        }

        if (dump) return dumpPrep(request, reply, prep)
        return await handleFile(request, reply, prep)
    }
    prep.message = '500 Internal Server Error'
    if (dump) return dumpPrep(request, reply, prep)
    return await handleFile(request, reply, prep)

}

const webHandler = { run }

export { webHandler }