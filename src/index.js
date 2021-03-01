const WorkersSentry = require('workers-sentry/worker');
const data = require('./data.yml');

// Util to send a text response
const textResponse = content => new Response(content, {
    headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
    },
});

// Util to send a JSON response
const jsonResponse = obj => new Response(JSON.stringify(obj), {
    headers: {
        'Content-Type': 'application/json',
    },
});

// Fetch a monitor from lean20
const fetchLean20 = (monitor, region) => fetch(
    `https://api.lean20.com/v1/reporting/ping/activity/${monitor}?limit=10&location=${region}`,
    { headers: { access_token: process.env.LEAN20_AUTH } },
).then(req => req.json());

// Post data to statuspage
const postStatuspage = (page, metric, data) => fetch(
    `https://api.statuspage.io/v1/pages/${page}/metrics/${metric}/data.json`,
    {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `OAuth ${process.env.STATUSPAGE_AUTH}`,
        },
        body: JSON.stringify({ data }),
    },
).then(req => req.json());

// Get the average up latency from a set of results
const averageLatency = results => {
    const upLatencies = results.filter(res => res.result === 1).map(res => res.latency);
    return upLatencies.reduce((sum, latency) => sum + latency, 0) / upLatencies.length;
};

// Fetch data for a monitor from lean20 and update statuspage metric
const updateMetric = async metric => {
    // Get the raw data from Lean20
    const rawData = await Promise.all(metric.lean20.regions.map(region => fetchLean20(metric.lean20.monitor, region)));

    // Flatten the data and group by minute
    const groupedData = rawData.flat(1).reduce((acc, res) => {
        const date = Math.floor(new Date(res.checked_at).getTime() / 1000 / 60);
        acc[date] = (acc[date] || []).concat(res);
        return acc;
    }, {});

    // Send to statuspage
    await Promise.all(Object.entries(groupedData).map(([minute, results]) => postStatuspage(
        metric.statuspage.page,
        metric.statuspage.metric,
        { timestamp: minute * 60, value: averageLatency(results) },
    )));
};

// Fetch all lean20 monitors and update statuspage metrics
const updateMetrics = sentry => Promise.all(
    data.metrics.map(metric => updateMetric(metric).catch(err => sentry.captureException(err))),
);

// Process all requests to the worker
const handleRequest = async ({ request, wait, sentry }) => {
    const url = new URL(request.url);

    // Health check route
    if (url.pathname === '/health') return textResponse('OK');

    // Get metrics route
    if (url.pathname === '/metrics') return jsonResponse(data);

    // Execute triggers route
    if (url.pathname === '/execute') {
        // Trigger each workflow in the background after
        wait(updateMetrics(sentry).catch(err => sentry.captureException(err)));

        // Return all metrics
        return jsonResponse(data);
    }

    // Not found
    return new Response(null, { status: 404 });
};

// Register the worker listener
addEventListener('fetch', event => {
    // Start Sentry
    const sentry = new WorkersSentry(event, process.env.SENTRY_DSN);

    // Process the event
    return event.respondWith(handleRequest({
        request: event.request,
        wait: event.waitUntil.bind(event),
        sentry,
    }).catch(err => {
        // Log & re-throw any errors
        console.error(err);
        sentry.captureException(err);
        throw err;
    }));
});

// Also listen for a cron trigger
addEventListener('scheduled', event => {
    // Start Sentry
    const sentry = new WorkersSentry(event, process.env.SENTRY_DSN);

    // Process the event
    return event.waitUntil(updateMetrics(sentry).catch(err => {
        // Log & re-throw any errors
        console.error(err);
        sentry.captureException(err);
        throw err;
    }));
});
