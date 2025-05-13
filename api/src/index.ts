import { Hono } from 'hono/tiny'

import packages from './packages'
import instance from './instance'
import stats from './stats'

const app = new Hono()

app.get('/', async c => {
    return c.redirect('https://lyrion.org/analytics/', 301)
})

app.route('/api/instance', instance)
app.route('/api/packages', packages)
app.route('/api/stats', stats)

app.get('/health', async c => c.json({ status: 'ok' }))

export default app