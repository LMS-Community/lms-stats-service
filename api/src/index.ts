import { Hono, Context, Env } from 'hono'

const app = new Hono()
const versionCheck = new RegExp(/^\d{1,2}\.\d{1,3}\.\d{1,3}$/)
const uaStringCheck = new RegExp(/^iTunes.*L(?:yrion|ogitech) M(?:usic|edia) Server/)

interface StatsData {
    os: string;
    osname: string;
    platform: string;
    version: string;
    revision: string;
    perl: string;
    players: number;
    plugins: string[];
    skin: string;
    language: string;
    tracks: number;
}

interface StatsSummary {
    versions?: string[];
    countries?: string[];
    os?: string[];
    plugins?: {
        names: string;
        counts: number;
    };
}

interface ValueCountsObject {
    v: string | number;
    c: number;
}

app.get('/', async c => {
    return c.redirect('https://lyrion.org/analytics/', 301)
})

app.get('/api/stats', async (c: Context) => {
    const results: StatsSummary = {}

    const getStats = async (identifier: string) => {
        const { results } = await c.env.DB.prepare(`
            SELECT JSON_EXTRACT(data, '$.${identifier}') AS v, COUNT(1) AS c
            FROM servers
            GROUP BY JSON_EXTRACT(data, '$.${identifier}')
            ORDER BY c DESC;
        `).all()

        return results.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
    }

    try {
        results.versions = await getStats('version')
        results.countries = await getStats('country')
        results.os = await getStats('os')

        let { results: plugins } = await c.env.DB.prepare(`
            SELECT COUNT(1) AS c, JSON_EACH.value AS v
            FROM servers, JSON_EACH(data, '$.plugins')
            GROUP BY JSON_EACH.value
            ORDER BY c DESC;
        `).all()

        results.plugins = plugins.map((item: ValueCountsObject) => { return { [item.v]: item.c }})
    }
    catch(e) {
        console.error(e)
        return c.json({err: e}, 500)
    }

    return c.json(results)
})

app.post('/api/instance/:id/', async (c: Context) => {
    const { id } = c.req.param()
    const idHeader = c.req.header('x-lms-id') as string
    const uaString = c.req.header('User-Agent') as string

    if (id !== idHeader || !uaStringCheck.test(uaString) ) return validationError(c)

    let {
        version = '',
        revision = '',
        os = '',
        osname = '',
        platform = '',
        perl = '',
        players = 0,
        plugins = [],
        skin = '',
        language = '',
        tracks = 0
    } = await c.req.json() as StatsData

    // TODO - better validation
    if (id.length !== 27
        || revision.length > 50
        || os.length > 100
        || osname.length > 20   // Perl's $^O is a short string
        || platform.length > 20
        || perl.length > 50
        || skin.length > 25
        || language.length > 5
        || plugins.length > 200
        || (version && !versionCheck.test(version))
        || (players && !Number.isInteger(players))
        || (tracks && !Number.isInteger(tracks))
        || (plugins.find(plugin => plugin.length > 25))
    ) {
        return validationError(c)
    }

    const country = c.req.raw?.cf?.country;

    const data = stringifyDataObject({
        os, osname, platform, version, revision, perl, players, plugins, country, skin, language, tracks
    })

    const { success } = await c.env.DB.prepare(`
        INSERT INTO servers (id, created, lastseen, data) VALUES(?, DATETIME(), DATETIME(), json(?))
            ON CONFLICT(id) DO UPDATE SET lastseen=DATETIME(), data=json(?);
    `).bind(id, data, data).run()

    if (success) {
        c.status(201)
        return c.text("Created or updated")
    } else {
        c.status(500)
        return c.text("Something went wrong")
    }
})

async function validationError(c: Context) {
    console.error(await c.req.json())
    c.status(400)
    return c.text("Invalid data");
}

function stringifyDataObject(data: object) {
    Object.keys(data).forEach((key: string) => {
        const value = data[key as keyof typeof data]
        if (value === undefined || value === null || (value as string | number).toString().length === 0) {
            delete data[key as keyof typeof data];
        }
    })

    return JSON.stringify(data)
}

export default app