// Starter app.js — CREATE-ONLY scaffold from project-baseline (node-service profile).
//
// This file is YOURS once generated. The baseline will never overwrite it (file-policy:
// whenPresent: leave). Shared runtime behaviour comes from versioned libraries — update it by
// bumping those dependencies, NOT by editing baseline-owned files. See docs/shared-libraries.md
// and design.md "Shared runtime behaviour".
//
// Libraries wired here:
//   @cica/logger        - pino logger factory
//   @cica/express-baseline - helmet/CSP/HSTS, headers, env validation, health, error handlers
// Web-only apps additionally use @cica/nunjucks-govuk for templating (not wired in this minimal
// starter — add it when the service renders HTML).

import express from 'express';
import { createLogger } from '@cica/logger';
import {
    applyBaselineSecurity,
    baselineErrorHandlers,
    healthRouter,
    validateEnv
} from '@cica/express-baseline';

// Fail fast on missing/invalid configuration at boot.
validateEnv({
    mandatory: ['APP_PORT'],
    optional: ['APP_ALLOW_INSECURE_COOKIE']
});

const app = express();
const logger = createLogger({ level: process.env.APP_LOG_LEVEL });

app.set('trust proxy', 1); // trust first proxy (ingress)

app.use(logger); // request logging first

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Hardened helmet/CSP, HSTS, security + Application-Version + cache-control headers.
// Pass per-app CSP directives here; the defaults are safe for a minimal service.
applyBaselineSecurity(app, {
    csp: {
        directives: {
            // TODO: tighten/extend for this service's needs.
            defaultSrc: ["'self'"]
        }
    }
});

// Baseline standard: health/readiness endpoint. Mount before app-specific routes.
app.use(healthRouter());

// ---------------------------------------------------------------------------
// App-specific wiring goes here. Mount your routers in the correct order.
// Replace this placeholder with your real routes.
// (Session / CSRF / rate limiting / static assets are app choices — see
//  docs/shared-libraries.md for the opt-in express-baseline helpers.)
// ---------------------------------------------------------------------------

// TODO: app.use('/your-path', yourRouter);

// notFound + central error handler — MUST be registered last.
// flavour: 'html' for web apps, 'jsonapi' for headless APIs.
baselineErrorHandlers(app, { flavour: 'html' });

export default app;
