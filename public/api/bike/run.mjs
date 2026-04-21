

const run = (request, reply) => {
    const urlParts = request.url.split('/').filter(part => part);
    return {
        // status, ok and message may override response header values
        // status: 200,
        // ok: true,
        message: 'Found your bike!',
        
        body: {
            id: 123,
            name: 'Speedy Bike'
        },
    }
}

export { run }