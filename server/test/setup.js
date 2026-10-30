// Loaded before every test file (node --import): force local mode and keep tests offline and deterministic.
process.env.SUPABASE_URL = "";
process.env.NODE_ENV = "test";
process.env.SENTRY_DSN = "";
process.env.POSTHOG_KEY = "";
process.env.RESEND_API_KEY = "";
process.env.SNAPTRADE_CLIENT_ID = "";
process.env.SNAPTRADE_CONSUMER_KEY = "";
process.env.STRIPE_SECRET_KEY = "";
