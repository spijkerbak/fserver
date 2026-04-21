
const run = (request, reply) => {
    const urlParts = request.url.split('/').filter(part => part);
    return {
        body: {
            type: 'ship',
            message: 'Ahoy!',
            // parts: urlParts
        }
    }

}

export { run }