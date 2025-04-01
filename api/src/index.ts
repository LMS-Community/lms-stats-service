import { Hono } from 'hono/tiny'

import instance from './instance'
import stats from './stats'
import time from './time'

const app = new Hono()

app.get('/', async c => {
    return c.redirect('https://lyrion.org/analytics/', 301)
})

app.route('/api/instance', instance)
app.route('/api/stats', stats)
app.route('/api/time', time)

app.get('/health', async c => c.json({ status: 'ok' }))

app.get('/api/geoip', async c => {
    return c.json({
        city: c.req.header('cf-ipcity'),
        country: c.req.header('cf-ipcountry'),
        continent: c.req.header('cf-ipcontinent'),
        latitude: c.req.header('cf-iplatitude'),
        longitude: c.req.header('cf-iplongitude'),
        region: c.req.header('cf-region'),
        regionCode: c.req.header('cf-region-code'),
        metroCode: c.req.header('cf-metro-code'),
        postalCode: c.req.header('cf-postal-code'),
        timezone: c.req.header('cf-timezone'),
        ip: c.req.header('cf-connecting-ip'),
    })
})

export default app