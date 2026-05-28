# fserver – a custom made web and api server

## Capabilities
- general web server
  - handles server side includes (virtual only)
  - can resizes images
  - handles range request for video streaming
- api server

## Modules used

See package.json

- fastify – high-performance web framework
- mime-types – of course 
- cors – to enable Cross-Origin Resource Sharing (CORS), for secure API access from different origins.
- pino-pretty – to make development logs more readable.
- sharp – for resizing images

## Setup

```bash
npm install

```

## SSL certificate

Generated for localhost with:

```bash
openssl req -x509 -out localhost.crt -keyout localhost.key \
  -newkey rsa:2048 -nodes -sha256 \
  -subj '/CN=localhost' -extensions EXT -config <( \
   printf "[dn]\nCN=localhost\n[req]\ndistinguished_name = dn\n[EXT]\nsubjectAltName=DNS:localhost\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth")
```

## Configure

Copy `config-example.json` to `config.json`. This serves the public folder as an example.
Adjust configuration to your own needs.

## Run

```bash
# might need sudo to use port 443
sudo npm start
```
