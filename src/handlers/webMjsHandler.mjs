import fs, { createReadStream } from 'fs'
import path from 'path'

import { pathFinder } from './pathFinder.mjs'

const handleMjs = async (mjsPath, webroot, parts) => {
    let content = await fs.promises.readFile(mjsPath, 'utf-8')
        return content
}

const webMjsHandler = {
    handleMjs: handleMjs
}

export { webMjsHandler }

