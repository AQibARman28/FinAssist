# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: university students in Bangladesh.** Their income is small or irregular (an allowance, tuition earnings, part-time work), and the job is making a tight monthly budget last while still putting something aside. They use the app in English.

**Secondary: recruiters and employers.** FinAssist is a job-portfolio project, so the people judging it sign up, click through it cold, and decide whether it proves the owner's skill.

## Product Purpose

A personal finance manager. Students record what they spend and earn, set monthly budgets by category, keep a wallet and a separate savings account, set savings goals, and see where their money goes.

For a student, success means knowing what is safe to spend this month and whether their goals are actually reachable. For the portfolio, success means the app holds up as a complete, working, secure product when someone tries it for the first time.

## Positioning

Two things set FinAssist apart from other money apps (confirmed by the owner):

- **Privacy and security as a feature.** Each person's data is encrypted with their own key, records are tamper-signed and checked on every read, 2FA is available, and sign-in tokens live in cookies that page scripts cannot read.
- **A realistic savings plan.** The planner works from the student's real monthly surplus, says whether each goal can be reached in time, and suggests how to split the surplus across goals.

Alongside these, the **financial health score and finance-management scores** are core to the product. They are rule-based today and are planned to become AI-assisted (see below).

## Operating Context

- Used on phones as much as on laptops. The app is installable (PWA manifest and icons), and the UI was built mobile-first, with a sticky top bar and slide-out menu on phones and a floating quick-add button.
- Amounts default to Bangladeshi Taka (BDT). Users can switch their profile to USD, EUR, GBP, INR, CAD, AUD, SGD or AED.
- Money follows a monthly rhythm: budgets are per month, and at the start of a month a rollover prompt asks what to do with last month's leftover.
- Quick entry accepts plain text with simple maths, such as "lunch 2*175 food".
- The site is hosted on Vercel and the server on Render's free tier, with data in MongoDB Atlas. After about 15 minutes with no visitors the server sleeps, so the first request can take up to a minute. The app shows a "Waking up the server" notice while it waits.

## Capabilities and Constraints

- **Features today:** expenses with natural-language quick add and user-owned categories; one-off and recurring income; category budgets per month; wallet, savings account and monthly rollover; savings goals with the planner; analytics (health score, spending comparison, high-spending alerts, tips); account settings (profile, currency, password, email change, 2FA).
- **AI:** tips and scores are rule-based today, and no AI service is called. The owner plans to add Google's free Gemini Flash for AI-assisted scores and insights once the current cleanup is finished. *Open discrepancy:* the site title, description and install text already say "AI-powered financial insights".
- **No investment-product recommendations anywhere.** Advice only splits the user's own surplus across their own goals.
- **The user decides.** Category and other suggestions never silently override the user's choice; anything the app can't match stays empty for the user to pick.
- **English only.** No Bangla version is planned.
- **Not built:** pasting bKash, Nagad or Rocket payment SMS was planned (docs/sprints/EXP-1-plan.md) but does not exist. Do not present it as a feature.
- *Open:* the suggested goal names in `src/components/dashboard/goals/GoalForm.tsx` (DPS, Hajj / Umrah, Wedding, Land / Flat, Child's education, plus Emergency Fund and New phone) mostly fit adult earners. Whether to tailor them to students is undecided.

## Brand Commitments

- Name: **FinAssist**.
- The owner's stated aim for the UI/UX: "a very luxurious consumer friendly UI".

## Evidence on Hand

- Live app: https://finassist101.vercel.app
- App icons: `public/icons/` (apple-touch-icon, favicon-32, icon-192, icon-512, maskable-512).
- Engineering write-ups that back the security claim: `../docs/security/HARDENING-2026-10.md`, `../docs/security/key-management.md`, `../docs/decisions/SEC-1-ecdsa.md`, and the sprint plans and postmortems in `../docs/sprints/`.
- Automated tests: a backend Jest suite of about 390 tests and a frontend suite of 86.
- **Absent, so never invent:** real user numbers, testimonials, reviews, press, partner logos, or bank and mobile-money integrations.

## Product Principles

1. **Make the protection visible.** Security is one of the two reasons FinAssist exists, so people should notice it, not find it buried.
2. **Plan from real money.** Goals and advice come from what the student actually earns and has left over. When a goal is out of reach, say so plainly.
3. **Claim only what ships.** Describe tips and scores as rule-based until the AI assistance is live, and never show planned features as working ones.
4. **The user decides.** Suggestions help but never override the student's own choices about categories, allocations or goals.
5. **Portfolio-grade finish.** Every flow has to hold up when a stranger tries it cold: no dead ends, no blank screens, and fast.
