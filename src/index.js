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
);

// Fetch data for a monitor from lean20 and update statuspage metric
const updateMetric = async metric => {
    const allData = await Promise.all(metric.lean20.regions.map(region => fetchLean20(metric.lean20.monitor, region)));
    console.log(JSON.stringify(allData, null, 2));
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
