import { Hono } from 'hono/tiny'
import { Context } from 'hono'

const app = new Hono()

const versionCheck = new RegExp(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/)
const uaStringCheck = new RegExp(/Squeezebox.*L(?:yrion|ogitech) M(?:usic|edia) Server/)

interface StatsData {
    os: string;
    osname: string;
    platform: string;
    version: string;
    revision: string;
    perl: string;
    players?: number;
    playerTypes?: object;
    playerModels?: object;
    playerCount?: number;
    plugins: string[];
    skin: string;
    language: string;
    tracks?: number;
}

app.post('/:id/', async (c: Context) => {
    const ip = c.req.header("CF-Connecting-IP")
    const { success: rateOk } = await c.env.STATS_UPDATE_LIMITER.limit({
        key: ip
    })

    if (!rateOk) {
        c.status(429)
        return c.text('429 Failure - rate limit exceeded, try again in a few minutes')
    }

    const { id } = c.req.param()
    const idHeader = c.req.header('x-lms-id') as string
    const uaString = c.req.header('User-Agent') as string

    if (!id) return validationError(c, 'Missing ID')
    if (id !== idHeader) return validationError(c, `${id} !== ${idHeader}`)
    if (!uaStringCheck.test(uaString) ) return validationError(c, uaString)

    const {
        version = '',
        revision = '',
        os = '',
        osname = '',
        platform = '',
        perl = '',
        players = 0,
        playerTypes,
        playerModels,
        plugins = [],
        skin = '',
        language = '',
        tracks = 0
    } = await c.req.json() as StatsData

    try {
        if (id.length !== 27
            || (revision && revision.length > 100)
            || (os && os.length > 100)
            || (osname && osname.length > 100)
            || (platform && platform.length > 50)
            || (perl && perl.length > 50)
            || (skin && skin.length > 50)
            || (language && language.length > 5)
            || (plugins && plugins.length > 250)
            || (version && !versionCheck.test(version))
            || (players && !Number.isInteger(+players))
            || (tracks && !Number.isInteger(+tracks))
            || (plugins.find(plugin => plugin.length > 50))
            || (playerTypes && Object.keys(playerTypes).length > 20)
            || (playerModels && Object.keys(playerModels).length > 50)
        ) {
            return validationError(c, `Invalid data`)
        }
    }
    catch(e: any) {
        try { const _x = id.length } catch(e) { console.error('id') }
        try { const _x = revision.length } catch(e) { console.error('revision') }
        try { const _x = os.length } catch(e) { console.error('os') }
        try { const _x = osname.length } catch(e) { console.error('osname') }
        try { const _x = platform.length } catch(e) { console.error('platform') }
        try { const _x = perl.length } catch(e) { console.error('perl') }
        try { const _x = skin.length } catch(e) { console.error('skin') }
        try { const _x = language.length } catch(e) { console.error('language') }
        try { const _x = plugins.length } catch(e) { console.error('plugins') }
        try { const _x = plugins && plugins.find(plugin => plugin.length > 50) } catch(e) { console.error('plugins2') }
        try { const _x = version.length } catch(e) { console.error('version') }
        try { const _x = playerTypes && Object.keys(playerTypes).length } catch(e) { console.error('playerTypes') }
        try { const _x = playerModels && Object.keys(playerModels).length } catch(e) { console.error('playerModels') }
        return validationError(c, `Validation exception: ${e.message}`)
    }

    const country = c.req.raw?.cf?.country;

    const data = {
        os, osname, platform, version, revision, perl, players, playerTypes, playerModels, plugins, country, skin, language, tracks
    }

    // we've fucked up LMS9: it would report any player, whether connected or not... at least
    // a first time. Let's not update the players if there are more than X new players
    if (version === '9.0.0' && players > 3) {
        await tweakPlayersFromExistingRecord(c, id, data, (results) => results.pc && players - results.pc > 3)
    }

    // don't downgrade an installation to zero players - use previous values instead, if available
    if (players == 0) {
        await tweakPlayersFromExistingRecord(c, id, data)
    }

    let dataJSON;

    try {
        dataJSON = stringifyDataObject(data)
    }
    catch(e: any) {
        return validationError(c, `Conversion error: ${e.message}`)
    }

    const { success } = await c.env.DB.prepare(`
        INSERT INTO servers (id, created, lastseen, data) VALUES(?, DATETIME(), DATETIME(), json(?))
            ON CONFLICT(id) DO UPDATE SET lastseen=DATETIME(), data=json(?);
    `).bind(id, dataJSON, dataJSON).run()

    if (success) {
        c.status(201)
        return c.text("")
    } else {
        c.status(500)
        return c.text("Something went wrong")
    }
})

async function tweakPlayersFromExistingRecord(c: Context, id: string, data: any, condition = (r: any) => true): Promise<any> {
    if (!id) return

    const results = await c.env.DB.prepare(`
        SELECT JSON_EXTRACT(data, '$.players') AS pc, JSON_EXTRACT(data, '$.playerTypes') AS pt, JSON_EXTRACT(data, '$.playerModels') AS pm
        FROM servers
        WHERE id = ?
    `).bind(id).first()

    if (results && condition(results)) {
        const { pc, pt, pm } = results

        data.players = parseInt(pc || 0)

        if (pt) {
            try { data.playerTypes = JSON.parse(pt) }
            catch (e) { console.error(e) }
        }

        if (pm) {
            try { data.playerModels = JSON.parse(pm) }
            catch (e) { console.error(e) }
        }
    }

    return data
}

async function validationError(c: Context, message?: string) {
    console.error(`Validation error (${message})`, { ...(await c.req.json()), id: c.req.param('id') })
    c.status(201)
    return c.text("");
}

function stringifyDataObject(data: object) {
    // remove empty values
    Object.keys(data).forEach((key: string) => {
        const value = data[key as keyof typeof data]
        if (value === undefined || value === null || (value as string | number).toString().length === 0) {
            delete data[key as keyof typeof data];
        }
    })

    return JSON.stringify(data)
}

export default app
