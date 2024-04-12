export interface StatsSummary {
    versions?: string[];
    countries?: string[];
    os?: string[];
    plugins?: {
        names: string;
        counts: number;
    };
}

export interface ValueCountsObject {
    v: string | number;
    c: number;
}

export async function getSummary(db: any, secs: number = 0): Promise<StatsSummary> {
    const results: StatsSummary = {}

    const condition = (secs > 0) ? 'WHERE UNIXEPOCH(DATE()) - UNIXEPOCH(lastseen) < ' + secs.toString() : '';

    const getStats = async (identifier: string) => {
        const { results } = await db.prepare(`
            SELECT JSON_EXTRACT(data, '$.${identifier}') AS v, COUNT(1) AS c
            FROM servers
            ${ condition }
            GROUP BY JSON_EXTRACT(data, '$.${identifier}')
            ORDER BY c DESC;
        `).all()

        return results.map((item: ValueCountsObject) => { return { [item.v]: item.c } })
    }

    results.versions = await getStats('version')
    results.countries = await getStats('country')
    results.os = await getStats('os')

    let { results: plugins } = await db.prepare(`
        SELECT COUNT(1) AS c, JSON_EACH.value AS v
        FROM servers, JSON_EACH(data, '$.plugins')
        GROUP BY JSON_EACH.value
        ORDER BY c DESC;
    `).all()

    results.plugins = plugins.map((item: ValueCountsObject) => { return { [item.v]: item.c }})

    return results
}
