# fserver – a custom made web and api server

## modules used

- fastify – high-performance web framework
- cors – to enable Cross-Origin Resource Sharing (CORS), for secure API access from different origins.
- pino-pretty – to make development logs more readable.
- sharp – for resizing images

## setup

```bash
npm init -y
npm install fastify cors pino-pretty mime-types sharp
npm audit fix --force
npm pkg set type="module"
npm pkg set scripts.start="node --watch app.js"
```

## run

```bash
npm start
```

## clone command

``` bash
git clone https://github.com/spijkerbak/fserver.git
```