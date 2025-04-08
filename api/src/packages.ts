import { Context } from 'hono'
import { Hono } from 'hono/tiny'
import { cache } from 'hono/cache'

const DEBUG = false
const GHCR_PACKAGES_URL = 'https://github.com/LMS-Community/slimserver/pkgs/container/lyrionmusicserver'
const MAX_AGE = 3600

const app = new Hono()

app.get('/pulls', DEBUG ? async (_: Context, next: Function) => { await next() } : cache({
    cacheName: 'lms-ghcr-pulls',
    cacheControl: `max-age=${MAX_AGE}`
}), async c => {
    const containerPage = await fetch(GHCR_PACKAGES_URL, {
        cf: {
            cacheEverything: true,
            cacheTtlByStatus: {
                '200-299': MAX_AGE,
                404: 1,
                '500-599': 0,
            }
        }
    })

    let pulls = 0

    if (!containerPage.body) {
        return c.json({
            pulls: 'unknown',
        })
    }

    const decoder = new TextDecoder('utf-8')

    for await (const chunk of containerPage.body) {
        const text = decoder.decode(chunk)
        let getNext = false

        for (const line of text.split('\n')) {
            if (line.includes('Total downloads')) {
                getNext = true
            }
            else if (getNext) {
                const matches = line.match(/>(\d+[km]*)</i)
                if (matches && matches[1]) {
                    pulls = parseInt(matches[1])
                    break
                }
            }
        }
    }

    return c.json({
        pulls,
    })
})

export default app
