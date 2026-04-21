
let paths = [
    '/',
    '/index.html',
    '/test.html',
    '/sub',
    '/sub/',
    '/sub/index.html',
    '/sub/test.html',
    '/nonexistent.html'
];
const apiEndpoints = [
    '/api/bike',
    '/api/bike/123',
    '/api/ship',
    '/api/ship/list',
    '/api/ship/get?id=45',
    '/api/ship/get/67',
    '/api/ship/get/?id=67',
    '/api/ship/get/length/99',
    '/api/nonexistent'
];

async function fetchWithStatus(url) {
    // step 1: await the fetch response
    const res = await fetch(url);
    // step 2: await the json body
    const data = await res.json();
    // step 3: return an object with status and data
    return {
        ok: data.ok || res.ok,
        status: data.status || res.status,
        message: data.message || res.statusText,
        body: data.body || {}
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('paths');
    paths.forEach(path => {
        const link = document.createElement('a');
        link.href = path;
        link.textContent = path;
        container.appendChild(link);
        container.appendChild(document.createElement('br'));
    })

    const table = document.querySelector('table');
    apiEndpoints.forEach((endpoint, index) => {
        let row = table.insertRow();
        let url = row.insertCell(0);
        let status = row.insertCell(1);
        let result = row.insertCell(2);
        url.textContent = endpoint;
        result.textContent = 'Loading...';
        fetchWithStatus(endpoint)
            .then(res => {
                result.textContent = JSON.stringify(res.body);
                status.textContent = JSON.stringify(
                    {
                        ok: res.ok,
                        status: res.status,
                        message: res.message
                    });
            })
            .catch(err => {
                result.textContent = 'Error: ' + err.message;
            })
    })
})
