// Terms of Service, Privacy Policy and Risk Disclaimer shown in the app and on the web.
// These are starting templates written for FinSight's actual features. Have a lawyer review them
// (and fill in the company name, address and governing law) before charging customers.

export const LEGAL_UPDATED = "October 27, 2026";
export const COMPANY = "FinSight";
export const CONTACT = "support@finsight.app";

export const LEGAL = {
  disclaimer: {
    title: "Risk Disclaimer",
    sections: [
      ["Education, not advice", `${COMPANY} provides educational research tools. Nothing in the app, including AI-generated briefings, Copilot answers, journal coaching, thesis checks, screens, backtests or option analysis, is investment, financial, legal or tax advice, or a recommendation to buy, sell or hold any security. ${COMPANY} is not a registered investment adviser or broker-dealer.`],
      ["AI can be wrong", "Our AI features summarize data and filings and can make mistakes, omit information or misread context. Always check important facts against the original sources (SEC filings, your broker's statements) before acting."],
      ["Trading is risky", "Trading and investing involve substantial risk, including the loss of more than you invest when using margin, short selling or options. Past performance and backtests do not guarantee future results. Only trade with money you can afford to lose."],
      ["Data may be delayed", "Market data, fundamentals and filings come from third parties and may be delayed, incomplete or incorrect. Indicator alerts use end-of-day data."],
      ["Tax tools", "Tax summaries and wash-sale flags are estimates based on the trades you enter or import. Your broker's 1099-B is the official record. Consult a tax professional."],
      ["Your decisions", "You are solely responsible for your investment decisions and for any trades you place with your broker. FinSight never places trades."],
    ],
  },
  terms: {
    title: "Terms of Service",
    sections: [
      ["Agreement", `By creating an account or using ${COMPANY}, you agree to these Terms and to the Risk Disclaimer. If you do not agree, do not use the service. You must be at least 18 years old.`],
      ["The service", `${COMPANY} offers stock research, AI briefings, an AI Copilot, a trading journal, alerts, portfolio analytics and related tools for educational purposes. We may change, add or remove features at any time.`],
      ["Your account", "Keep your login secure and tell us about any unauthorized use. You are responsible for activity on your account. One person per account."],
      ["Plans and billing", "Free plans have daily limits. Pro is a recurring subscription billed through Stripe until cancelled. A free trial, when offered, converts to a paid subscription unless cancelled before it ends. You can cancel anytime in Manage billing; access continues until the end of the paid period. Fees are non-refundable except where required by law."],
      ["Acceptable use", "Do not misuse the service: no scraping, reverse engineering, reselling, automated bulk access, attempts to bypass limits or security, or using the service to break any law or market rule."],
      ["Broker connections", "If you connect a brokerage, the connection is read-only and provided by SnapTrade under its own terms. You can disconnect at any time."],
      ["Content and AI output", "You keep ownership of what you enter (trades, notes, theses). You give us permission to process it to run the service. AI output is provided as is and may be inaccurate."],
      ["No warranty", `The service is provided "as is" without warranties of any kind. We do not guarantee that it will be uninterrupted, error-free or that data is accurate.`],
      ["Limitation of liability", `To the maximum extent permitted by law, ${COMPANY} is not liable for trading losses, lost profits or indirect damages arising from your use of the service. Our total liability is limited to the fees you paid in the 12 months before the claim.`],
      ["Ending your account", "You can delete your account at any time in Account. We may suspend accounts that violate these Terms."],
      ["Changes", "We may update these Terms. If changes are material, we will ask you to accept them again in the app."],
      ["Contact", `Questions: ${CONTACT}.`],
    ],
  },
  privacy: {
    title: "Privacy Policy",
    sections: [
      ["What we collect", "Your email and login; what you enter (watchlist, theses, holdings, journal trades, alerts, rules, Copilot messages); usage of features (to apply plan limits); and, if you connect a broker, your positions and trade history (read-only)."],
      ["How we use it", "To run the features you use, send the notifications you turn on, apply plan limits, prevent abuse and improve the product. We do not sell your personal data and we do not show ads."],
      ["AI processing", "To answer questions and write briefings, relevant data is sent to our AI provider (Anthropic) under its commercial API terms, which do not use API data for training by default."],
      ["Service providers", "Supabase (database and login), Stripe (payments; we never see your full card number), SnapTrade (optional broker connections), Expo (push notifications), PostHog (product analytics, if enabled) and market data providers (Finnhub, Massive, SEC EDGAR)."],
      ["Sharing links", "Share links contain a snapshot (for example your win rate) without your name, email or dollar amounts. Anyone with the link can see it."],
      ["Security", "Data is encrypted in transit; broker credentials are held by SnapTrade and the connection secret is encrypted at rest. Access to your data is limited to running the service."],
      ["Your choices", "You can view, edit or delete what you entered in the app, turn off the morning brief and notifications, disconnect your broker, and delete your account at any time in Account. Deleting your account removes your data from our systems."],
      ["Retention", "We keep your data while your account is open. Payment records are kept as required by law."],
      ["Contact", `Privacy questions or requests: ${CONTACT}.`],
    ],
  },
};
